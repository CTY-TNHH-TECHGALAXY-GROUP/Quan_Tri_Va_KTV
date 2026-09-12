import { isUtilityService } from '@/lib/booking.logic';
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
 * ⚡ PERFORMANCE (v2 - 2026-07-27):
 *   - Parallelize queries bằng Promise.all khi không có dependency
 *   - Nhóm 1: Resolve bookingId (activeItems || turnQueue)
 *   - Nhóm 2: Fetch chính (booking + turnInfo + items + rewardConfig + nextAssigns) song song
 *   - Nhóm 3: Enrich (services + rooms) song song
 *   - Nhóm 4: Extras (next service + prefetch checklist) song song
 * 
 * 📤 TRẢ VỀ: NextResponse trực tiếp (không qua orchestrator)
 * ============================================================
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBusinessDate, ktvMatchesSeg } from '../_shared/utils';
import { HandoverService } from '@/lib/services/HandoverService';
import { formatBodyAreas, normalizeStrength } from '@/lib/booking.logic';

export async function handleGetBooking(request: Request): Promise<NextResponse> {
    const { searchParams } = new URL(request.url);
    const technicianCode = searchParams.get('techCode')?.toUpperCase();
    const bookingIdParam = searchParams.get('bookingId');

    try {
        const API_START = Date.now();
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        let bookingId = bookingIdParam;

        // ─── 1. RESOLVE BOOKING ID ───
        // (Phần này PHẢI tuần tự vì có logic branching phức tạp)
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
        // (PHẢI tuần tự - có write operations / side effects)
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

        const T_RESOLVE = Date.now() - API_START;

        // ═══════════════════════════════════════════════════════════════
        // ⚡ NHÓM 2: PARALLEL FETCH CHÍNH (5 queries cùng lúc)
        // Tất cả chỉ cần bookingId + technicianCode → chạy song song
        // ═══════════════════════════════════════════════════════════════
        const today = getBusinessDate();
        
        const [bookingRes, turnInfoRes, itemsRes, rewardConfigRes, nextAssignsRes, guestsRes] = await Promise.all([
            // Q1: Fetch booking data
            supabase
                .from('Bookings')
                .select('*')
                .eq('id', bookingId)
                .maybeSingle(),

            // Q2: Fetch TurnQueue info cho KTV này
            technicianCode
                ? supabase
                    .from('TurnQueue')
                    .select('last_served_at, start_time, booking_item_id, booking_item_ids, room_id, bed_id, status')
                    .eq('employee_id', technicianCode)
                    .eq('date', today)
                    .eq('current_order_id', bookingId!)
                    .maybeSingle()
                : Promise.resolve({ data: null, error: null }),

            // Q3: Fetch BookingItems
            supabase
                .from('BookingItems')
                .select('*')
                .eq('bookingId', bookingId!),

            // Q4: Fetch reward config
            supabase
                .from('SystemConfigs')
                .select('value')
                .eq('key', 'ktv_instant_reward_enabled')
                .maybeSingle(),

            // Q5: Fetch next assignments (for next booking info)
            technicianCode
                ? supabase
                    .from('KtvAssignments')
                    .select('booking_id, planned_start_time')
                    .eq('employee_id', technicianCode)
                    .eq('business_date', today)
                    .in('status', ['QUEUED', 'READY'])
                    .neq('booking_id', bookingId!)
                    .order('priority', { ascending: true })
                    .order('planned_start_time', { ascending: true, nullsFirst: false })
                    .order('sequence_no', { ascending: true })
                    .order('created_at', { ascending: true })
                    .limit(5)
                : Promise.resolve({ data: null, error: null }),

            // Q6: Fetch BookingGuests
            bookingId
                ? supabase
                    .from('BookingGuests')
                    .select('id, guest_label')
                    .eq('booking_id', bookingId)
                : Promise.resolve({ data: null, error: null }),
        ]);

        const T_PARALLEL_FETCH = Date.now() - API_START;
        const booking = bookingRes.data;
        const bError = bookingRes.error;
        const turnInfo = turnInfoRes.data;
        const items = itemsRes.data;
        const iError = itemsRes.error;
        const rewardConfig = rewardConfigRes.data;
        const nextAssignsRaw = nextAssignsRes.data;
        const guests = guestsRes.data;

        if (bError) throw bError;
        if (!booking) {
            // Booking not found → check for next assignment
            if (technicianCode) {
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

        if (iError) console.error('Error fetching booking items:', iError);

        // ═══════════════════════════════════════════════════════════════
        // ⚡ NHÓM 3: PARALLEL ENRICH (Services + Rooms cùng lúc)
        // ═══════════════════════════════════════════════════════════════
        const roomId = turnInfo?.room_id || booking.roomName;

        const [svcsRes, roomDataRes] = await Promise.all([
            // Q6: Fetch all services (for enrichment)
            (items && items.length > 0)
                ? supabase
                    .from('Services')
                    .select('id, code, nameVN, nameEN, duration, focusConfig, description, procedure, service_description, is_utility')
                    .limit(1000)
                : Promise.resolve({ data: null, error: null }),

            // Q7: Fetch room procedures
            roomId
                ? supabase
                    .from('Rooms')
                    .select('prep_procedure, clean_procedure, handover_checklist')
                    .eq('id', roomId)
                    .maybeSingle()
                : Promise.resolve({ data: null, error: null }),
        ]);

        const T_ENRICH_FETCH = Date.now() - API_START;
        let itemsWithService = items || [];
        if (items && items.length > 0) {
            const svcs = svcsRes.data;
            const svcMap = new Map();
            if (svcs) {
                svcs.forEach((s: any) => {
                    if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
                    if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
                });
            }

            const guestMap = new Map();
            if (guests) {
                guests.forEach((g: any) => guestMap.set(g.id, g));
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
                const focusAreas = formatBodyAreas(opts.focus || i.focus || opts.focusArea || '');
                const avoidAreas = formatBodyAreas(opts.avoid || i.avoid || '');
                const strength = normalizeStrength(opts.strength || '');
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

                const guestObj = guestMap.get(i.guest_id);
                const guest_label = guestObj?.guest_label || '';
                const guest_index = guestObj?.guest_index || 0;
                const guest_customer_name = guestObj?.customer_name || '';

                return {
                    ...i,
                    guest_label: guest_label,
                    guest_index: guest_index,
                    guest_customer_name: guest_customer_name,
                    service_name: (technicianCode && opts?.serviceNamesForKtvs?.[technicianCode]) || opts._generatedDisplayName || opts.displayName || getI18nStr(svc?.nameVN || svc?.nameEN || svc?.name, `Dịch vụ ${rawSId}`),
                    service_description: svc?.service_description || getI18nStr(svc?.description, ''),
                    procedure: svc?.procedure || null,
                    focusConfig: svc?.focusConfig || null,
                    duration: finalDuration,
                    is_utility: svc?.is_utility ?? (sId === 'nhs0900'),
                    customerNote: customerNote,
                    noteForKtv: noteForKtv,
                    focus: focusAreas,
                    avoid: avoidAreas,
                    strength: strength,
                    therapistGender: therapistGender
                };
            });
        }

        // Room procedures
        let roomProcedures: { prep_procedure: string[] | null, clean_procedure: string[] | null, handover_checklist: string[] | null } = { prep_procedure: null, clean_procedure: null, handover_checklist: null };
        if (roomDataRes.data) {
            const roomData = roomDataRes.data;
            roomProcedures = {
                prep_procedure: roomData.prep_procedure || null,
                clean_procedure: roomData.clean_procedure || null,
                handover_checklist: roomData.handover_checklist || null
            };
        }

        // Reward config
        const ktv_instant_reward_enabled = rewardConfig?.value ?? true;

        // ─── 4. RESOLVE ACTIVE ITEM + SEGMENT INDEX ───
        const assignedItemIds = (turnInfo?.booking_item_ids && turnInfo.booking_item_ids.length > 0) 
            ? turnInfo.booking_item_ids 
            : (turnInfo?.booking_item_id ? [turnInfo.booking_item_id] : []);
            
        let activeItemId = null;
        let activeSegmentIndex = 0;
        let statusSource = 'none';

        const ktvItems = itemsWithService.filter((i: any) => {
            return i.technicianCodes && 
                   Array.isArray(i.technicianCodes) && 
                   technicianCode && 
                   i.technicianCodes.some((c: string) => c.trim().toUpperCase() === technicianCode.trim().toUpperCase());
        });

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

        // ─── 6. ON-THE-FLY TIMELINE SHIFT CALCULATION ───
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
            if (isUtilityService(item)) return;
            
            // 🔥 GUARD: Nếu dịch vụ này đã bị gộp (có mergedIntoId), KTV không cần quan tâm chặng ảo của nó
            const opts = typeof item.options === 'string' ? JSON.parse(item.options) : (item.options || {});
            if (opts.mergedIntoId) return;

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
            myCalculatedStart = mySegments[0].origStart;
            let prevEndStr = mySegments[0].actualEndTime || getDynamicEndTime(mySegments[0].actualStartTime || mySegments[0].origStart, mySegments[0].duration);
            for (let i = 1; i < mySegments.length; i++) {
                let calcStart = mySegments[i].origStart;
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

        // ═══════════════════════════════════════════════════════════════
        // ⚡ NHÓM 4: PARALLEL EXTRAS (next booking details + prefetch checklist)
        // ═══════════════════════════════════════════════════════════════
        let nextBookingId: string | null = null;
        let nextServiceName: string | null = null;
        let nextStartTime: string | null = null;
        let prefetchedDynamicChecklist: any = null;

        // Validate next assigns against active bookings
        let validNextAssign: any = null;
        if (nextAssignsRaw && nextAssignsRaw.length > 0) {
            const bIds = nextAssignsRaw.map((a: any) => a.booking_id);
            const { data: bData } = await supabase.from('Bookings').select('id, status').in('id', bIds).not('status', 'in', '("COMPLETED","CANCELLED")');
            const validBIds = new Set(bData?.map((b: any) => b.id) || []);
            validNextAssign = nextAssignsRaw.find((a: any) => validBIds.has(a.booking_id));
        }

        if (validNextAssign) {
            nextBookingId = validNextAssign.booking_id;
            if (validNextAssign.planned_start_time) {
                const pst = new Date(validNextAssign.planned_start_time);
                const vnPst = new Date(pst.getTime() + 7 * 60 * 60 * 1000);
                nextStartTime = `${String(vnPst.getUTCHours()).padStart(2, '0')}:${String(vnPst.getUTCMinutes()).padStart(2, '0')}`;
            }
        }

        // Determine computed status for prefetch decision
        let computedStatus = booking.status;
        const activeItemForStatus = itemsWithService.find((i: any) => i.id === activeItemId) || itemsWithService[0];
        if (activeItemForStatus) computedStatus = activeItemForStatus.status;

        // ⚡ Chạy song song: next service lookup + prefetch checklist
        const parallelExtras = await Promise.all([
            // Extra 1: Fetch next service name (nếu có next booking)
            (validNextAssign && technicianCode)
                ? (async () => {
                    try {
                        const { data: allNextItems } = await supabase
                            .from('BookingItems')
                            .select('serviceId, options, duration, technicianCodes')
                            .eq('bookingId', validNextAssign.booking_id);

                        let nextItems: any[] = [];
                        if (allNextItems) {
                            const upperTechCode = technicianCode.trim().toUpperCase();
                            nextItems = allNextItems.filter((i: any) => 
                                i.technicianCodes && 
                                Array.isArray(i.technicianCodes) &&
                                i.technicianCodes.some((c: string) => c.trim().toUpperCase() === upperTechCode)
                            );
                        }

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
                                return names.join(' + ');
                            }
                        }
                        return null;
                    } catch { return null; }
                })()
                : Promise.resolve(null),

            // Extra 2: Âm thầm tải trước Checklist Bàn giao ngay từ lúc KTV đang làm dịch vụ (IN_PROGRESS)
            // Để triệt tiêu hoàn toàn thời gian load (0 giây) khi chuyển sang màn Bàn Giao
            (computedStatus === 'IN_PROGRESS' || computedStatus === 'FEEDBACK' || computedStatus === 'CLEANING')
                ? (async () => {
                    try {
                        const sCode = activeItemForStatus?.serviceCode || activeItemForStatus?.service_code || '';
                        const sCat = activeItemForStatus?.service_category || activeItemForStatus?.category || '';
                        const rId = turnInfo?.room_id || booking.roomId || activeItemForStatus?.roomId || null;
                        const sId = activeItemForStatus?.serviceId || null;
                        console.log(`🔍 [Prefetch Checklist] sCode=${sCode} sCat=${sCat} rId=${rId} itemId=${activeItemId || activeItemForStatus?.id} serviceId=${sId}`);
                        const result = await HandoverService.generateDynamicChecklist(
                            supabase,
                            rId,
                            sCode,
                            sCat,
                            booking.id,
                            activeItemId || activeItemForStatus?.id,
                            sId
                        );
                        console.log(`✅ [Prefetch Checklist] Result: ${result.length} items`, JSON.stringify(result));
                        return result;
                    } catch (err) {
                        console.error("Prefetch dynamic checklist failed:", err);
                        return null;
                    }
                })()
                : Promise.resolve(null),
        ]);

        nextServiceName = parallelExtras[0];
        prefetchedDynamicChecklist = parallelExtras[1];

        const T_TOTAL = Date.now() - API_START;
        console.log(`⚡ [API PERF] GET /api/ktv/booking | Resolve: ${T_RESOLVE}ms | ParallelFetch: ${T_PARALLEL_FETCH}ms | Enrich: ${T_ENRICH_FETCH}ms | Total: ${T_TOTAL}ms | bookingId: ${bookingId} | ktv: ${technicianCode}`);

        // ─── 7. FETCH STAFF WORK TYPES ───
        const allKtvIds = new Set<string>();
        if (technicianCode) allKtvIds.add(technicianCode);
        itemsWithService.forEach((i: any) => {
            if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                i.technicianCodes.forEach((c: string) => allKtvIds.add(c));
            }
        });
        
        let ktvWorkTypes: Record<string, string> = {};
        if (allKtvIds.size > 0) {
            const { data: staffData } = await supabase.from('Staff').select('id, work_type').in('id', Array.from(allKtvIds));
            if (staffData) {
                staffData.forEach((s: any) => {
                    ktvWorkTypes[s.id] = s.work_type || 'A';
                });
            }
        }

        // ─── 8. CALC SUB-SUFFIX FOR BILL CODE ───
        let finalBillCode = booking.billCode;
        if (itemsWithService && itemsWithService.length > 0) {
            const allItemGroups = new Map<string, any[]>();
            const nonUtilityAllItems = itemsWithService.filter((i: any) => !i.is_utility);
            const itemsToGroup = nonUtilityAllItems.length > 0 ? nonUtilityAllItems : itemsWithService;
            
            for (const item of itemsToGroup) {
                const opts = typeof item.options === 'string' ? JSON.parse(item.options) : (item.options || {});
                const groupId = opts.mergedIntoId || item.id;
                if (!allItemGroups.has(groupId)) allItemGroups.set(groupId, []);
                allItemGroups.get(groupId)!.push(item);
            }

            const groupIdList = Array.from(allItemGroups.keys());
            if (groupIdList.length > 1) {
                // Find which group the KTV's active item belongs to
                let myGroupId = null;
                const activeItem = itemsWithService.find((i: any) => i.id === activeItemId) || ktvItems[0];
                if (activeItem) {
                    const opts = typeof activeItem.options === 'string' ? JSON.parse(activeItem.options) : (activeItem.options || {});
                    myGroupId = opts.mergedIntoId || activeItem.id;
                }
                
                const myIdx = groupIdList.indexOf(myGroupId);
                if (myIdx !== -1) {
                    finalBillCode = `${booking.billCode}-${String.fromCharCode(65 + myIdx)}`;
                }
            }
        }

        // ─── 9. RESPONSE ───
        return NextResponse.json({
            success: true,
            _perf: { resolve: T_RESOLVE, fetch: T_PARALLEL_FETCH, enrich: T_ENRICH_FETCH, total: T_TOTAL },
            data: {
                ...booking,
                billCode: finalBillCode,
                prefetchedDynamicChecklist,
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
                handoverChecklist: roomProcedures.handover_checklist,
                ktv_instant_reward_enabled: ktv_instant_reward_enabled,
                nextBookingId: nextBookingId,
                nextServiceName: nextServiceName,
                nextStartTime: nextStartTime,
                ktvWorkTypes: ktvWorkTypes
            },
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('API Error (GET /api/ktv/booking):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

