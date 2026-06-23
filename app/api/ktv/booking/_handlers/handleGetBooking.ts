/**
 * ============================================================
 * 📋 HANDLER: GET BOOKING FOR KTV
 * ============================================================
 * 
 * Fetch và enrich booking data cho KTV Dashboard.
 * 
 * 📋 LUỒNG:
 *   1. Resolve bookingId từ nhiều nguồn
 *      Priority: bookingIdParam → activeItems → TurnQueue → KtvAssignments
 *   2. Auto-activate KtvAssignment nếu cần
 *   3. Fetch booking + enrich items với Services data
 *   4. Resolve active item + segment index
 *   5. Fetch room procedures (prep/clean)
 *   6. On-the-fly timeline shift (gối đầu cùng KTV)
 *   7. Fetch next booking info
 * 
 * 🚫 KHÔNG ĐƯỢC:
 *   - Modify bất kỳ data nào (trừ auto-activate assignment)
 *   - Return stale data (luôn query fresh từ DB)
 *   - Tính timeline cho KTV khác (chỉ tính cho requesting KTV)
 * 
 * 📤 TRẢ VỀ: NextResponse trực tiếp (không qua orchestrator)
 * ============================================================
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBusinessDate, ktvMatchesSeg } from '../_shared/utils';

export async function handleGetBooking(request: Request): Promise<NextResponse> {
    const { searchParams } = new URL(request.url);
    const technicianCode = searchParams.get('techCode');
    const bookingIdParam = searchParams.get('bookingId');

    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        let bookingId = bookingIdParam;

        // ─── 1. RESOLVE BOOKING ID ───
        if (!bookingId) {
            if (!technicianCode) {
                return NextResponse.json({ success: false, error: 'Technician code or bookingId is required' }, { status: 400 });
            }

            // 1.a Lấy tất cả item active của KTV
            const { data: activeItems } = await supabase
                .from('BookingItems')
                .select('bookingId, status, id, segments')
                .contains('technicianCodes', [technicianCode])
                .in('status', ['IN_PROGRESS'])
                .order('timeStart', { ascending: false, nullsFirst: false });

            let validActiveItem = null;
            if (activeItems && activeItems.length > 0) {
                for (const item of activeItems) {
                    let segs: any[] = [];
                    try {
                        segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []);
                    } catch { segs = []; }
                    
                    const mySegs = segs.filter((s: any) => ktvMatchesSeg(s.ktvId, technicianCode));
                    const isStillWorking = mySegs.length === 0 || mySegs.some((s: any) => !s.actualEndTime);
                    
                    if (isStillWorking) {
                        validActiveItem = item;
                        break;
                    }
                }
            }

            if (validActiveItem) {
                bookingId = validActiveItem.bookingId;
            } else {
                // 1.b Nếu không có item IN_PROGRESS, lấy từ TurnQueue (đơn mới gán)
                const today = getBusinessDate();
                const { data: turn, error: tError } = await supabase
                    .from('TurnQueue')
                    .select('current_order_id, booking_item_id, booking_item_ids, status')
                    .eq('employee_id', technicianCode)
                    .eq('date', today)
                    .maybeSingle();

                if (tError) throw tError;
                if (!turn || !turn.current_order_id) {
                    const { data: nextAssigns } = await supabase.from('KtvAssignments').select('booking_id').eq('employee_id', technicianCode).eq('business_date', today).in('status', ['QUEUED', 'READY']).order('priority', { ascending: true }).order('planned_start_time', { ascending: true, nullsFirst: false }).limit(5);
                    let nextAssign = null;
                    if (nextAssigns && nextAssigns.length > 0) {
                        const bIds = nextAssigns.map((a: any) => a.booking_id);
                        const { data: bData } = await supabase.from('Bookings').select('id, status').in('id', bIds).not('status', 'in', '("COMPLETED","CANCELLED")');
                        const validBIds = new Set(bData?.map((b: any) => b.id) || []);
                        nextAssign = nextAssigns.find((a: any) => validBIds.has(a.booking_id));
                    }
                    if (nextAssign) return NextResponse.json({ success: true, data: { nextBookingId: nextAssign.booking_id } });
                    return NextResponse.json({ success: true, data: null });
                }
                bookingId = turn.current_order_id;
            }
        }

        // ─── 2. AUTO-ACTIVATE ASSIGNMENT ───
        if (bookingId && technicianCode) {
            const today = getBusinessDate();
            const { data: assign } = await supabase
                .from('KtvAssignments')
                .select('id, status, booking_item_id, room_id, bed_id')
                .eq('employee_id', technicianCode)
                .eq('booking_id', bookingId)
                .eq('business_date', today)
                .maybeSingle();
            
            if (assign && (assign.status === 'QUEUED' || assign.status === 'READY')) {
                // 2a. Tự động giải phóng các active assignment khác bị kẹt của KTV này trong ngày
                const { data: activeAssigns } = await supabase
                    .from('KtvAssignments')
                    .select('id, booking_id')
                    .eq('employee_id', technicianCode)
                    .eq('business_date', today)
                    .eq('status', 'ACTIVE')
                    .neq('booking_id', bookingId);
                
                if (activeAssigns && activeAssigns.length > 0) {
                    const activeBookingIds = activeAssigns.map(a => a.booking_id);
                    await supabase
                        .from('KtvAssignments')
                        .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
                        .in('id', activeAssigns.map(a => a.id));
                    
                    console.log(`[KTV API] Auto-completed prior active assignments for KTV ${technicianCode} on bookings: ${activeBookingIds.join(', ')}`);
                }

                // 2b. Kích hoạt assignment của đơn mới thành ACTIVE
                await supabase
                    .from('KtvAssignments')
                    .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
                    .eq('id', assign.id);
                
                console.log(`[KTV API] Auto-activated assignment for KTV ${technicianCode} on booking ${bookingId}`);

                // 2c. Đồng bộ thông tin đơn mới sang TurnQueue
                const { data: currentTurn } = await supabase
                    .from('TurnQueue')
                    .select('status')
                    .eq('employee_id', technicianCode)
                    .eq('date', today)
                    .maybeSingle();

                const newStatus = (currentTurn?.status === 'off') ? 'off' : 'assigned';

                await supabase
                    .from('TurnQueue')
                    .update({
                        status: newStatus,
                        current_order_id: bookingId,
                        booking_item_id: assign.booking_item_id,
                        booking_item_ids: assign.booking_item_id ? [assign.booking_item_id] : [],
                        room_id: assign.room_id,
                        bed_id: assign.bed_id,
                        start_time: null,
                        estimated_end_time: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('employee_id', technicianCode)
                    .eq('date', today);
                
                console.log(`[KTV API] Synced TurnQueue for KTV ${technicianCode} to new booking ${bookingId}`);
            }
        }

        // ─── 3. FETCH BOOKING + ENRICH ITEMS ───
        const { data: booking, error: bError } = await supabase
            .from('Bookings')
            .select('*')
            .eq('id', bookingId)
            .maybeSingle();

        if (bError) throw bError;
        if (!booking) {
            if (technicianCode) {
                const today = getBusinessDate();
                const { data: nextAssigns } = await supabase.from('KtvAssignments').select('booking_id').eq('employee_id', technicianCode).eq('business_date', today).in('status', ['QUEUED', 'READY']).order('priority', { ascending: true }).order('planned_start_time', { ascending: true, nullsFirst: false }).limit(5);
                let nextAssign = null;
                if (nextAssigns && nextAssigns.length > 0) {
                    const bIds = nextAssigns.map((a: any) => a.booking_id);
                    const { data: bData } = await supabase.from('Bookings').select('id, status').in('id', bIds).not('status', 'in', '("COMPLETED","CANCELLED")');
                    const validBIds = new Set(bData?.map((b: any) => b.id) || []);
                    nextAssign = nextAssigns.find((a: any) => validBIds.has(a.booking_id));
                }
                if (nextAssign) return NextResponse.json({ success: true, data: { nextBookingId: nextAssign.booking_id } });
            }
            return NextResponse.json({ success: true, data: null });
        }

        // 3a. Lấy thông tin TurnQueue của booking này
        let turnInfo = null;
        if (technicianCode) {
            const vnMs = new Date().getTime() + (7 * 60 * 60 * 1000);
            const today = new Date(vnMs).toISOString().split('T')[0];
            const { data: turn } = await supabase
                .from('TurnQueue')
                .select('last_served_at, start_time, booking_item_id, booking_item_ids, room_id, bed_id, status')
                .eq('employee_id', technicianCode)
                .eq('date', today)
                .eq('current_order_id', bookingId)
                .maybeSingle();
            turnInfo = turn;
        }

        // 3b. Lấy BookingItems
        const { data: items, error: iError } = await supabase
            .from('BookingItems')
            .select('*')
            .eq('bookingId', booking.id);

        if (iError) console.error('Error fetching booking items:', iError);

        // 3c. Enrich items với Services data
        let itemsWithService = items || [];
        if (items && items.length > 0) {
            const { data: svcs, error: svcError } = await supabase
                .from('Services')
                .select('id, code, nameVN, nameEN, duration, focusConfig, description, procedure, service_description, is_utility')
                .limit(1000);

            const svcMap = new Map();
            if (svcs) {
                svcs.forEach((s: any) => {
                    if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
                    if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
                });
            }

            itemsWithService = items.map((i: any) => {
                const rawSId = String(i.serviceId || '').trim();
                const sId = rawSId.toLowerCase();
                const svc = svcMap.get(sId);
                const opts = i.options || {};
                let bCustomerNote = '';
                if (booking?.notes && typeof booking.notes === 'string' && booking.notes.trim().startsWith('{')) {
                    try {
                        const pNotes = JSON.parse(booking.notes);
                        bCustomerNote = pNotes.customerNote || pNotes.note || '';
                    } catch(e) {}
                } else if (booking?.notes && typeof booking.notes === 'string' && !booking.notes.trim().startsWith('{')) {
                    bCustomerNote = String(booking.notes);
                }
                const customerNote = [bCustomerNote, opts.note, i.customerNote].filter(Boolean).join(' | ');
                const notesForKtvs = opts.notesForKtvs || {};
                const noteForKtv = (technicianCode && notesForKtvs[technicianCode]) 
                    ? notesForKtvs[technicianCode] 
                    : (opts.noteForKtv || '');
                const focusAreas = Array.isArray(opts.focus) ? opts.focus.join(', ') : (i.focus || opts.focusArea || '');
                const avoidAreas = Array.isArray(opts.avoid) ? opts.avoid.join(', ') : (opts.avoid || '');
                const strength = opts.strength || '';
                const therapistGender = opts.therapist || ''; 

                let finalDuration = svc?.duration || (sId.includes('nhs0000') ? 1 : 60);
                if (opts?.vipDuration) {
                    finalDuration = Number(opts.vipDuration);
                } else if (opts?.duration) {
                    finalDuration = Number(opts.duration);
                }

                const getI18nStr = (val: any, fallback: string = '') => {
                    if (typeof val === 'object' && val !== null) return val.vn || val.en || String(val);
                    return val || fallback;
                };

                return {
                    ...i,
                    service_name: opts.displayName || getI18nStr(svc?.nameVN || svc?.nameEN || svc?.name, `Dịch vụ ${rawSId}`),
                    service_description: svc?.service_description || getI18nStr(svc?.description, ''),
                    procedure: svc?.procedure || null,
                    focusConfig: svc?.focusConfig || null,
                    duration: finalDuration,
                    is_utility: svc?.is_utility ?? (sId === 'nhs0900'), // ✅ Truyền is_utility xuống KTVDashboard
                    customerNote: customerNote,
                    noteForKtv: noteForKtv,
                    focus: focusAreas,
                    avoid: avoidAreas,
                    strength: strength,
                    therapistGender: therapistGender
                };
            });
        }

        // ─── 4. RESOLVE ACTIVE ITEM + SEGMENT INDEX ───
        const assignedItemIds = (turnInfo?.booking_item_ids && turnInfo.booking_item_ids.length > 0) 
            ? turnInfo.booking_item_ids 
            : (turnInfo?.booking_item_id ? [turnInfo.booking_item_id] : []);
            
        let activeItemId = null;
        let activeSegmentIndex = 0;
        let statusSource = 'none';

        const ktvItems = itemsWithService.filter((i: any) => 
            i.technicianCodes && 
            Array.isArray(i.technicianCodes) && 
            technicianCode && 
            i.technicianCodes.some((c: string) => c.trim().toUpperCase() === technicianCode.trim().toUpperCase())
        );

        if (ktvItems.length > 0) {
            for (const item of ktvItems) {
                let segs: any[] = [];
                try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []); } catch { segs = []; }
                const mySegs = segs.filter((s: any) => ktvMatchesSeg(s.ktvId, technicianCode));
                const runningIdx = mySegs.findIndex((s: any) => s.actualStartTime && !s.actualEndTime);
                if (runningIdx !== -1) {
                    activeItemId = item.id;
                    activeSegmentIndex = runningIdx;
                    statusSource = 'segment_runtime';
                    break;
                }
            }

            if (!activeItemId) {
                const inProgressItem = ktvItems.find((i: any) => i.status === 'IN_PROGRESS');
                if (inProgressItem) {
                    activeItemId = inProgressItem.id;
                    statusSource = 'item_status';
                    let segs: any[] = [];
                    try { segs = typeof inProgressItem.segments === 'string' ? JSON.parse(inProgressItem.segments) : (Array.isArray(inProgressItem.segments) ? inProgressItem.segments : []); } catch { segs = []; }
                    const mySegs = segs.filter((s: any) => ktvMatchesSeg(s.ktvId, technicianCode));
                    const nextIdx = mySegs.findIndex((s: any) => !s.actualEndTime);
                    activeSegmentIndex = nextIdx !== -1 ? nextIdx : 0;
                }
            }
            
            if (!activeItemId && turnInfo?.booking_item_id) {
                const turnItem = ktvItems.find((i: any) => i.id === turnInfo.booking_item_id);
                if (turnItem) {
                    activeItemId = turnItem.id;
                    statusSource = 'turnqueue_legacy';
                }
            }
            
            if (!activeItemId && assignedItemIds.length > 0) {
                activeItemId = assignedItemIds[0];
                statusSource = 'turnqueue_array';
            }
            
            if (!activeItemId) {
                activeItemId = ktvItems[0].id;
                statusSource = 'first_found';
            }
        }

        // ─── 5. FETCH ROOM PROCEDURES ───
        let roomProcedures: { prep_procedure: string[] | null, clean_procedure: string[] | null } = { prep_procedure: null, clean_procedure: null };
        const roomId = turnInfo?.room_id || booking.roomName;
        if (roomId) {
            const { data: roomData } = await supabase
                .from('Rooms')
                .select('prep_procedure, clean_procedure')
                .eq('id', roomId)
                .maybeSingle();
            if (roomData) {
                roomProcedures = {
                    prep_procedure: roomData.prep_procedure || null,
                    clean_procedure: roomData.clean_procedure || null
                };
            }
        }

        // ─── 6. ON-THE-FLY TIMELINE SHIFT CALCULATION ───
        // CHỈ tính nối tiếp cho segments CỦA CÙNG 1 KTV (gối đầu).
        // KTV khác nhau → giữ nguyên giờ gốc (song song).
        let finalDispatchStartTime = turnInfo?.start_time;
        
        const formatToHourMinute = (isoString: string | null | undefined): string => {
            if (!isoString) return '--:--';
            if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;
            let parseString = isoString;
            if (!isoString.endsWith('Z') && !isoString.includes('+')) parseString = isoString.replace(' ', 'T') + 'Z';
            const d = new Date(parseString);
            if (isNaN(d.getTime())) return isoString;
            const dVn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
            return `${String(dVn.getUTCHours()).padStart(2, '0')}:${String(dVn.getUTCMinutes()).padStart(2, '0')}`;
        };
        const getDynamicEndTime = (startStr?: string | null, durationMins: number = 60) => {
            if (!startStr) return '--:--';
            const formatted = formatToHourMinute(startStr);
            if (formatted === '--:--') return '--:--';
            let [h, m] = formatted.split(':').map(Number);
            m += durationMins;
            h += Math.floor(m / 60);
            m = m % 60;
            h = h % 24;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        // Collect only THIS KTV's segments (not all KTVs)
        const mySegments: { origStart: string; duration: number; actualStartTime?: string; actualEndTime?: string }[] = [];
        itemsWithService.forEach((item: any) => {
            if (item.is_utility === true || item.serviceId === 'NHS0900' || item.service_name?.toLowerCase().includes('phòng riêng') || item.service_name?.toLowerCase().includes('phong rieng')) return;
            let segs: any[] = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            segs.forEach((s: any) => {
                if (ktvMatchesSeg(s.ktvId, technicianCode)) {
                    mySegments.push({
                        origStart: s.startTime || item.timeStart || '',
                        duration: Number(s.duration) || Number(item.duration) || 60,
                        actualStartTime: s.actualStartTime,
                        actualEndTime: s.actualEndTime
                    });
                }
            });
        });

        mySegments.sort((a, b) => a.origStart.localeCompare(b.origStart));

        let myCalculatedStart = '';
        if (mySegments.length > 0) {
            // Chặng đầu: luôn dùng giờ gốc từ lễ tân
            myCalculatedStart = mySegments[0].origStart;

            // Chặng 2+: nối tiếp nếu cùng KTV (gối đầu)
            let prevEndStr = mySegments[0].actualEndTime || getDynamicEndTime(mySegments[0].actualStartTime || mySegments[0].origStart, mySegments[0].duration);
            for (let i = 1; i < mySegments.length; i++) {
                let calcStart = mySegments[i].origStart;
                // Chỉ shift nếu chặng trước kết thúc SAU giờ bắt đầu chặng này
                if (prevEndStr > calcStart) {
                    calcStart = prevEndStr;
                }
                const runtimeAnchor = mySegments[i].actualStartTime || calcStart;
                prevEndStr = mySegments[i].actualEndTime || getDynamicEndTime(runtimeAnchor, mySegments[i].duration);
            }
        }

        if (myCalculatedStart) {
            finalDispatchStartTime = myCalculatedStart;
        }

        // ─── 7. FETCH NEXT BOOKING INFO ───
        let nextBookingId = null;
        let nextServiceName = null;
        let nextStartTime = null;
        if (technicianCode) {
            const today = getBusinessDate();
            const { data: nextAssigns } = await supabase
                .from('KtvAssignments')
                .select('booking_id, planned_start_time')
                .eq('employee_id', technicianCode)
                .eq('business_date', today)
                .in('status', ['QUEUED', 'READY'])
                .neq('booking_id', booking.id)
                .order('priority', { ascending: true })
                .order('planned_start_time', { ascending: true, nullsFirst: false })
                .order('sequence_no', { ascending: true })
                .order('created_at', { ascending: true })
                .limit(5);
            
            let nextAssign = null;
            if (nextAssigns && nextAssigns.length > 0) {
                const bIds = nextAssigns.map((a: any) => a.booking_id);
                const { data: bData } = await supabase.from('Bookings').select('id, status').in('id', bIds).not('status', 'in', '("COMPLETED","CANCELLED")');
                const validBIds = new Set(bData?.map((b: any) => b.id) || []);
                nextAssign = nextAssigns.find((a: any) => validBIds.has(a.booking_id));
            }
            if (nextAssign) {
                nextBookingId = nextAssign.booking_id;

                // Format planned_start_time to HH:mm VN
                if (nextAssign.planned_start_time) {
                    const pst = new Date(nextAssign.planned_start_time);
                    const vnPst = new Date(pst.getTime() + 7 * 60 * 60 * 1000);
                    nextStartTime = `${String(vnPst.getUTCHours()).padStart(2, '0')}:${String(vnPst.getUTCMinutes()).padStart(2, '0')}`;
                }

                // Fetch service name from the next booking's items assigned to this KTV
                const { data: nextItems } = await supabase
                    .from('BookingItems')
                    .select('serviceId, options, duration')
                    .eq('bookingId', nextAssign.booking_id)
                    .contains('technicianCodes', [technicianCode]);

                if (nextItems && nextItems.length > 0) {
                    const svcIds = nextItems.map((ni: any) => String(ni.serviceId || '').trim().toLowerCase()).filter(Boolean);
                    if (svcIds.length > 0) {
                        const { data: svcs } = await supabase
                            .from('Services')
                            .select('id, code, nameVN')
                            .limit(500);
                        const svcMap = new Map();
                        if (svcs) svcs.forEach((s: any) => {
                            if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
                            if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
                        });
                        const names = nextItems.map((ni: any) => {
                            const displayName = ni.options?.displayName;
                            if (displayName) return displayName;
                            const svc = svcMap.get(String(ni.serviceId || '').trim().toLowerCase());
                            const nameVN = svc?.nameVN;
                            return typeof nameVN === 'object' ? (nameVN?.vn || nameVN?.en || `DV`) : (nameVN || `DV`);
                        });
                        nextServiceName = names.join(' + ');
                    }
                }
            }
        }

        // ─── 8. RESPONSE ───
        return NextResponse.json({
            success: true,
            data: {
                ...booking,
                dispatcherNote: booking.notes || '',
                BookingItems: itemsWithService,
                assignedItemId: activeItemId,
                assignedItemIds: ktvItems.map((i: any) => i.id),
                activeSegmentIndex: activeSegmentIndex,
                statusSource: statusSource,
                last_served_at: turnInfo?.last_served_at,
                dispatchStartTime: finalDispatchStartTime,
                assignedRoomId: turnInfo?.room_id,
                assignedBedId: turnInfo?.bed_id,
                roomPrepProcedure: roomProcedures.prep_procedure,
                roomCleanProcedure: roomProcedures.clean_procedure,
                nextBookingId: nextBookingId,
                nextServiceName: nextServiceName,
                nextStartTime: nextStartTime
            },
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('API Error (GET /api/ktv/booking):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

