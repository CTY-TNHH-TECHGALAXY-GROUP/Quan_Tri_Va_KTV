'use server';
import { isUtilityService } from '@/lib/booking.logic';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission, requireBusinessUser } from '@/lib/auth-server';
import { sendPushNotification } from '@/lib/push-helper';
import { createNotification } from '@/lib/notification-helper';
import { closeOpenPause, voidSegment } from '@/lib/segment-time';
import { liveDispatchConflict, savedPlanFields } from '@/lib/dispatch-live-guard';
import { ktvMetadataMap, parseKtvOptions, parseKtvSegments, ktvMatchesSeg } from '@/lib/ktvUtils';
import { isTwoSlotSequential } from '@/lib/dispatch-status';
import { performSequentialLifecycle } from '@/lib/services/SequentialLifecycleService';
import { currentCounterActor } from '@/lib/counter-action-log';
import { loadRatingConfig, clampRating, type RatingScale } from '@/lib/services/RatingScaleService';
import { punishTurnIfIdle } from '@/lib/turn-punish';
import { layTrangThaiBaoCuaKtv, canhBaoLechKichBan } from '@/lib/ktv-notify-check';
import { BookingModificationService } from '@/lib/services/BookingModificationService';
import { recalculateEstimatedEndTime } from '@/lib/time-helper';
import { isPlaceholderStaffId, isNewExternalKtvToken, externalNameOfToken, externalKtvNameProblem, findExternalKtvByName } from '@/lib/constants/staff.constants';
import { checkedInStaffIds } from '@/lib/attendance/checkedInToday';
import { findKtvsNeedingCheckinConfirm } from '@/lib/attendance/dispatchCheckinGate';
import { COMPLETED_STATUSES, isDummyPhone, isDummyEmail, isReturningCustomer, isNameMatch } from '@/lib/customer.logic';
import { unstable_noStore as noStore } from 'next/cache';
import { after } from 'next/server';

// Cờ chỉ dùng trên màn điều phối (bản nháp "Nối tiếp" chưa lưu) — không bao giờ ghi xuống DB.
function stripDraftOnlyOptions(payload: any) {
    if (!Array.isArray(payload?.itemUpdates)) return payload;
    return { ...payload, itemUpdates: payload.itemUpdates.map((u: any) => {
        if (!u?.options || typeof u.options !== 'object') return u;
        const { _draftSequential, ...options } = u.options;
        return { ...u, options };
    }) };
}

/** Scale of a rating being entered now: the one the screen showed, else the current setting. */
async function resolveRatingScale(supabase: any, scaleShown?: number): Promise<RatingScale> {
    if (scaleShown === 4 || scaleShown === 5) return scaleShown;
    return (await loadRatingConfig(supabase)).scale;
}

async function applyDispatchEdit(supabase: any, bookingId: string, action: string, payload: any) {
    payload = stripDraftOnlyOptions(payload);
    const actor = await currentCounterActor();
    const result = await supabase.rpc(['DRAFT','DISPATCH'].includes(action) ? 'dispatch_commit_form' : 'dispatch_apply_edit', { p_booking_id: bookingId, p_action: action,
        p_payload: payload, p_actor: actor });
    if (result.error?.message === 'OVERLAP_CONFIRM_REQUIRED') {
        try { return { data: JSON.parse(result.error.details), error: null }; } catch { /* Keep the database error. */ }
    }
    return result;
}

async function notifyAdjustedDurations(bookingId: string, changes: any[] = []) {
    const warnings: string[] = [];
    for (const change of changes) {
        let notified = false;
        try {
            notified = await createNotification({ bookingId, employeeId: change.employeeId, type: 'KTV_ORDER_CHANGED',
                message: change.removedB
                    ? `Bạn không còn phân công cho dịch vụ này.`
                    : `Quầy đã thay đổi thời gian dịch vụ của bạn thành ${change.minutes} phút (${change.startTime}–${change.endTime}). Vui lòng kiểm tra đồng hồ trong ứng dụng.` });
        } catch (error) { console.error('Duration notification failed:', error); }
        if (!notified) warnings.push(`Đã lưu giờ mới nhưng chưa báo được cho ${change.employeeId}; vui lòng báo trực tiếp.`);
    }
    if (changes.length) {
        // Báo admin: rule WARNING chỉ cho admin/dev nhận (KTV không nhận).
        const actor = await currentCounterActor().catch(() => null);
        const summary = changes.map((c: any) => c.removedB ? `bỏ B ${c.employeeId}` : `${c.employeeId} ${c.minutes}′`).join(', ');
        const ok = await createNotification({ bookingId, type: 'WARNING',
            message: `Đơn ${bookingId}: quầy${actor?.name ? ` (${actor.name})` : ''} đổi thời gian dịch vụ đang làm — ${summary}.` }).catch(() => false);
        if (!ok) warnings.push('Đã lưu giờ mới nhưng chưa tạo được thông báo cho admin.');
    }
    return warnings;
}

async function resolveGuestIdsForUpdate(
    supabase: any,
    bookingId: string,
    itemUpdates: any[],
    existingItemsBefore: any[]
) {
    const { data: currentGuests, error: guestsError } = await supabase.from('BookingGuests').select('id').eq('booking_id', bookingId);
    if (guestsError) throw guestsError;
    const dbItemsMap = new Map(existingItemsBefore?.map(i => [i.id, i.guest_id]) || []);
    const guestIdsDb = currentGuests?.map((g: any) => g.id) || [];
    
    const updatesToApply: { itemId: string, guestId: string }[] = [];
    const newGuests: any[] = [];
    
    // Group by UI grouping
    const groups = new Map<string, string[]>();
    for (const update of itemUpdates) {
        const uiGroupId = update.options?.customerGroupId || update.options?.mergedIntoId;
        if (uiGroupId) {
            if (!groups.has(uiGroupId)) groups.set(uiGroupId, []);
            groups.get(uiGroupId)!.push(update.id);
        } else {
            if (!groups.has(update.id)) groups.set(update.id, []);
            groups.get(update.id)!.push(update.id);
        }
    }
    
    let availableGuests = [...guestIdsDb];
    const usedGuestIds = new Set<string>();
    
    // ĐÁNH DẤU CÁC GUEST_ID ĐÃ BỊ CHIẾM BỞI CÁC DỊCH VỤ KHÔNG NẰM TRONG LẦN CẬP NHẬT NÀY
    const updatedItemIds = new Set(itemUpdates.map(u => u.id));
    for (const [id, gId] of dbItemsMap.entries()) {
        if (gId && !updatedItemIds.has(id)) {
            usedGuestIds.add(gId);
        }
    }
    
    for (const [groupId, itemIds] of groups.entries()) {
        // Ưu tiên kế thừa guest_id của chính các item trong nhóm
        let targetGuestId = itemIds.map(id => dbItemsMap.get(id)).find(id => id);
        
        if (!targetGuestId) {
            targetGuestId = availableGuests.find(id => !usedGuestIds.has(id));
            if (targetGuestId) {
                availableGuests = availableGuests.filter(id => id !== targetGuestId);
            } else {
                if (guestIdsDb.length === 1) {
                    targetGuestId = guestIdsDb[0];
                } else {
                    const crypto = require('crypto');
                    targetGuestId = crypto.randomUUID();
                    const nextIndex = guestIdsDb.length + 1;
                    newGuests.push({
                        id: targetGuestId,
                        booking_id: bookingId,
                        guest_index: nextIndex,
                        guest_label: `Khách ${nextIndex}`,
                        status: 'PENDING'
                    });
                    guestIdsDb.push(targetGuestId);
                }
            }
        }
        
        usedGuestIds.add(targetGuestId);
        
        for (const id of itemIds) {
            if (dbItemsMap.get(id) !== targetGuestId) {
                updatesToApply.push({ itemId: id, guestId: targetGuestId! });
                dbItemsMap.set(id, targetGuestId);
            }
        }
    }

    return { updatesToApply, newGuests };
}



export async function getDispatchData(date: string, _timestamp?: number) {
    noStore();
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Fetch Staff (Only KTVs based on Users role). Mã placeholder EXT_/C_ (đã
        //    ĐÃ NGHỈ) vẫn lấy để thẻ đơn cũ còn hiện tên; chúng không vào hàng đợi.
        const { data: techUsers, error: tuError } = await supabase.from('Users').select('code').eq('role', 'TECHNICIAN');
        if (tuError) throw tuError;
        const techCodes = new Set((techUsers || []).map(u => u.code));

        const { data: allStaffs, error: sError } = await supabase.from('Staff').select('id, full_name, avatar_url, gender, status, skills, phone, position, experience, work_type, feature_flags, online_status, travel_minutes, available_from, available_until');
        if (sError) throw sError;
        
        const staffs = (allStaffs || []).filter(s => 
            (techCodes.has(s.id) || isPlaceholderStaffId(s.id)) && 
            s.status !== 'KHÓA_TÀI_KHOẢN'
        );

        // Fetch Discipline Points cho tháng hiện tại
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const { data: pointsData } = await supabase
            .from('KTVDisciplinePoints')
            .select('staff_id, total_points')
            .eq('month', month)
            .eq('year', year);
        
        const pointsMap = Object.fromEntries((pointsData || []).map(p => [p.staff_id, p.total_points]));
        
        staffs.forEach(s => {
            (s as any).totalPoints = pointsMap[s.id] !== undefined ? pointsMap[s.id] : 100;
        });

        const { data: rawTurns, error: tError } = await supabase
            .from('TurnQueue')
            .select('id, employee_id, date, check_in_order, queue_position, status, turns_completed, current_order_id, booking_item_id, booking_item_ids, room_id, bed_id, start_time, estimated_end_time')
            .eq('date', date);
        if (tError) throw tError;

        // Apply correct sorting (turns_completed ASC for A/B/C, net_hours DESC for D)
        const turnsWithWorkType = rawTurns.map(t => {
            const st = staffs.find(s => s.id === t.employee_id);
            return { ...t, work_type: st?.work_type || 'TYPE_A' };
        });

        const typeA = turnsWithWorkType.filter(t => t.work_type === 'TYPE_A');
        const typeB = turnsWithWorkType.filter(t => t.work_type === 'TYPE_B');
        const typeC = turnsWithWorkType.filter(t => t.work_type === 'TYPE_C');
        const typeD = turnsWithWorkType.filter(t => t.work_type === 'TYPE_D');

        const sortABC = (a: any, b: any) => {
            if ((a.turns_completed || 0) !== (b.turns_completed || 0)) return (a.turns_completed || 0) - (b.turns_completed || 0);
            if ((a.check_in_order || 0) !== (b.check_in_order || 0)) return (a.check_in_order || 0) - (b.check_in_order || 0);
            return (a.employee_id || '').localeCompare(b.employee_id || '');
        };

        typeA.sort(sortABC);
        typeB.sort(sortABC);
        typeC.sort(sortABC);

        if (typeD.length > 0) {
            const { KtvTypeDTurnService } = await import('@/lib/services/KtvTypeDTurnService');
            const { getBusinessToday } = await import('@/lib/business-date');

            // Tua vừa xong còn nằm trong hàng đợi cho tới khi có người rút ra tính.
            // Rút ngay phần của các KTV trong bảng, giống hệt `/api/turns` đang làm.
            //
            // ⚠️ Trước 10/09/2026 chỗ này đọc thẳng sổ cái mà KHÔNG rút hàng đợi —
            // bảng điều phối là màn duy nhất chỉ biết đọc, không bao giờ cập nhật.
            // Mà `net_hours` lại là khoá xếp thứ tự nhận khách của loại D, nên quầy
            // chia khách theo số giờ cũ: KTV vừa xong tua vẫn mang giờ của lần
            // trước. Đo hôm đó có 8/13 KTV chụm trong vòng 5 phút giờ tích luỹ —
            // đủ để một tua vào sổ trễ là lật thứ tự.
            const { drainQueueForStaff } = await import('@/lib/services/KtvDLedgerWriter');
            await drainQueueForStaff(supabase, typeD.map(t => t.employee_id));

            // Tháng/năm theo NGÀY LÀM VIỆC, không theo ngày lịch — lúc 02:00 ngày 01/09
            // ngày làm việc vẫn là 31/08, phải xếp hạng theo giờ tích lũy tháng 8.
            const businessToday = await getBusinessToday(supabase);
            const hoursMap = await KtvTypeDTurnService.getMonthlyNetHours(
                supabase,
                typeD.map(t => t.employee_id),
                Number(businessToday.slice(5, 7)),
                Number(businessToday.slice(0, 4))
            );
            
            typeD.forEach(t => (t as any).net_hours = hoursMap[t.employee_id] || 0);
            
            typeD.sort((a: any, b: any) => {
                if ((b.net_hours || 0) !== (a.net_hours || 0)) return (b.net_hours || 0) - (a.net_hours || 0);
                if ((a.check_in_order || 0) !== (b.check_in_order || 0)) return (a.check_in_order || 0) - (b.check_in_order || 0);
                return (a.employee_id || '').localeCompare(b.employee_id || '');
            });
        }

        const turns = [...typeA, ...typeB, ...typeC, ...typeD];

        // Cờ "đã điểm danh hôm nay" cho nhãn "Chưa điểm danh" ở ô chọn KTV (cùng nguồn với
        // cổng processDispatch và Sổ tua — lib/attendance/checkedInToday).
        const checkedInToday = await checkedInStaffIds(supabase, turns.map(t => t.employee_id), date);
        turns.forEach(t => { (t as any).checked_in_today = checkedInToday.has(t.employee_id); });

        const { resolveStaffShiftEndTimes } = await import('@/lib/shift.constants');
        const shiftEndMap = await resolveStaffShiftEndTimes(supabase, turns.map(t => t.employee_id), date);
        turns.forEach(t => { (t as any).shift_end_time = shiftEndMap[t.employee_id] || null; });

        // Dọn phần hàng đợi CÒN LẠI sau khi đã trả dữ liệu — không làm chậm bảng.
        // Bảng điều phối mở suốt ca ở quầy và tự tải lại theo realtime, nên đây là
        // nơi dọn hàng đợi đều đặn nhất trong cả hệ thống.
        after(async () => {
            const { drainQueueBackground } = await import('@/lib/services/KtvDLedgerWriter');
            await drainQueueBackground(supabase);
        });

        // 3. Fetch Bookings for selected date
        // bookingDate is "timestamp without time zone"
        const startOfDay = `${date} 00:00:00`;
        const endOfDay = `${date} 23:59:59`;

        // 🔧 EGRESS FIX: Only select needed columns for Bookings
        const { data: bData, error: bError } = await supabase
            .from('Bookings')
            .select('id, billCode, customerId, customerName, customerLang, customerPhone, customerEmail, timeBooking, bookingDate, createdAt, updatedAt, status, totalAmount, paymentMethod, technicianCode, bedId, roomName, notes, accessToken, rating, rating_scale, feedbackNote, focusAreaNote, timeStart, timeEnd, source, guestCount, nationality, customerGender, parent_booking_id, sub_suffix')
            .in('source', ['STANDARD_WALK_IN', 'VIP_WALK_IN', 'MIXED_WALK_IN'])
            .gte('bookingDate', startOfDay)
            .lte('bookingDate', endOfDay)
            .neq('status', 'SPLIT')
            .order('createdAt', { ascending: true });

        if (bError) throw bError;

        let bookings: any[] = bData || [];

        // Fetch VAT info from Customers
        const customerIds = Array.from(new Set(bookings.map(b => b.customerId).filter(Boolean)));
        const { data: customersData } = await supabase
            .from('Customers')
            .select('id, taxCode')
            .in('id', customerIds);
        const taxCodeMap = Object.fromEntries((customersData || []).map(c => [c.id, c.taxCode]));

        bookings = bookings.map(b => ({
            ...b,
            hasVat: !!taxCodeMap[b.customerId]
        }));

        // Fetch historical visits for returning customer tag (using shared library)

        const uniqueCustomerIds = Array.from(new Set(bookings.map(b => b.customerId).filter(Boolean)));
        const validPhones = Array.from(new Set(bookings.map(b => !b.customerId && !isDummyPhone(b.customerPhone) ? b.customerPhone : null).filter(Boolean)));
        const validEmails = Array.from(new Set(bookings.map(b => !b.customerId && isDummyPhone(b.customerPhone) && !isDummyEmail(b.customerEmail) ? b.customerEmail : null).filter(Boolean)));
        
        // Find bookings that have NO customerId AND (dummy phone) AND (dummy email) AND HAVE a name
        const dummyBookings = bookings.filter(b => !b.customerId && isDummyPhone(b.customerPhone) && isDummyEmail(b.customerEmail) && b.customerName);
        
        let visitMap: Record<string, number> = {};
        
        // For customerId: fetch customerName too for name-matching (same algorithm as CRM)
        // Manager often reuses one guest account for many different people
        const historicalByCustomerId = new Map<string, any[]>();
        if (uniqueCustomerIds.length > 0) {
            const { data } = await supabase.from('Bookings')
                .select('customerId, customerName')
                .in('status', COMPLETED_STATUSES)
                .in('customerId', uniqueCustomerIds);
            if (data) {
                data.forEach(d => {
                    if (d.customerId) {
                        if (!historicalByCustomerId.has(d.customerId)) historicalByCustomerId.set(d.customerId, []);
                        historicalByCustomerId.get(d.customerId)!.push(d);
                    }
                });
            }
        }

        if (validPhones.length > 0) {
            const { data } = await supabase.from('Bookings').select('customerPhone').in('status', COMPLETED_STATUSES).in('customerPhone', validPhones);
            if (data) data.forEach(d => { if (d.customerPhone) visitMap[d.customerPhone] = (visitMap[d.customerPhone] || 0) + 1; });
        }

        if (validEmails.length > 0) {
            const { data } = await supabase.from('Bookings').select('customerEmail').in('status', COMPLETED_STATUSES).in('customerEmail', validEmails);
            if (data) data.forEach(d => { if (d.customerEmail) visitMap[d.customerEmail] = (visitMap[d.customerEmail] || 0) + 1; });
        }

        // Handle dummy bookings by checking both dummy phone/email AND name
        if (dummyBookings.length > 0) {
            await Promise.all(dummyBookings.map(async (b) => {
                const key = `DUMMY_${b.id}`;
                let query = supabase.from('Bookings').select('id', { count: 'exact' })
                    .in('status', COMPLETED_STATUSES)
                    .ilike('customerName', b.customerName.trim());
                
                if (b.customerPhone) query = query.eq('customerPhone', b.customerPhone);
                else query = query.filter('customerPhone', 'in', '("",null)');
                
                if (b.customerEmail) query = query.eq('customerEmail', b.customerEmail);
                else query = query.filter('customerEmail', 'in', '("",null)');
                
                const { count } = await query;
                visitMap[key] = count || 0;
            }));
        }

        bookings = bookings.map(b => {
            let count = 0;
            if (b.customerId && historicalByCustomerId.has(b.customerId)) {
                // Real accounts sharing customerId should be counted as the same customer regardless of name
                count = historicalByCustomerId.get(b.customerId)!.length;
            } else if (!isDummyPhone(b.customerPhone)) {
                count = visitMap[b.customerPhone] || 0;
            } else if (!isDummyEmail(b.customerEmail)) {
                count = visitMap[b.customerEmail] || 0;
            } else if (b.customerName) {
                count = visitMap[`DUMMY_${b.id}`] || 0;
            }

            return {
                ...b,
                visitCount: count,
                isReturning: isReturningCustomer(count)
            };
        });

        // 4. Fetch Services FIRST to build map (safer than complex filtering)
        const { data: allServices, error: svcError } = await supabase
            .from('Services')
            .select('id, code, nameVN, nameEN, duration, description, category, priceVND, imageUrl, is_utility, min_ktv_required, service_group')
            .limit(1000);

        if (svcError) {
            console.error('❌ [Server] Error fetching Services:', svcError.message);
        }
        console.log(`📡 [Server] Fetched: ${allServices?.length || 0} services for mapping`);

        let servicesMap: Record<string, { name: string; duration: number; description: string; is_utility: boolean; min_ktv_required?: number; service_group?: string; category?: string }> = {};
        if (allServices) {
            allServices.forEach((s: any) => {
                const info = {
                    name: (typeof s.nameVN === 'object' && s.nameVN !== null) ? (s.nameVN.vn || s.nameVN.en || s.nameVN) : (s.nameVN || s.nameEN || `Dịch vụ ${s.code || s.id}`),
                    duration: s.duration ?? 60,
                    description: (typeof s.description === 'object' && s.description !== null) 
                        ? (s.description.vn || s.description.en || '') 
                        : (s.description || ''),
                    is_utility: s.is_utility ?? false,  // ✅ is_utility từ DB
                    min_ktv_required: s.min_ktv_required ?? 1,
                    service_group: s.service_group ?? 'MAIN',
                    category: s.category
                };
                
                // Trình dọn dẹp cuối cùng: Đảm bảo không còn object nào lọt vào UI
                if (typeof info.name === 'object') info.name = String(info.name);
                if (typeof info.description === 'object') info.description = String(info.description);
                if (s.id) servicesMap[String(s.id).trim().toLowerCase()] = info;
                if (s.code) servicesMap[String(s.code).trim().toLowerCase()] = info;
            });
        }
        console.log(`📡 [Server] servicesMap has nhs0002: ${!!servicesMap['nhs0002']}`);

        // 5. Fetch BookingItems separately
        if (bookings.length > 0) {
            const bookingIds = bookings.map(b => b.id);
            const { data: items, error: iError } = await supabase
                .from('BookingItems')
                .select('*, segments, Services!BookingItems_serviceId_fkey(is_utility, nameVN, nameEN)')
                .in('bookingId', bookingIds);

            if (iError) {
                console.error('❌ [Server] Error fetching BookingItems:', iError.message);
            }

            // Fetch BookingGuests
            const { data: guests, error: gError } = await supabase
                .from('BookingGuests')
                .select('*')
                .in('booking_id', bookingIds)
                .order('guest_index', { ascending: true });

            if (gError) {
                console.error('❌ [Server] Error fetching BookingGuests:', gError.message);
            }

            // Attach BookingItems (with service info) and BookingGuests to each booking
            bookings = bookings.map(b => {
                const bGuests = (guests || []).filter(g => g.booking_id === b.id).map(g => ({
                    id: g.id,
                    bookingId: g.booking_id,
                    guestIndex: g.guest_index,
                    guestLabel: g.guest_label,
                    customerName: g.customer_name,
                    gender: g.gender,
                    nationality: g.nationality,
                    bedId: g.bed_id,
                    roomId: g.room_id,
                    notes: g.notes,
                    focusArea: g.focus_area,
                    status: g.status,
                    rating: g.rating,
                    ktv_ratings: g.ktv_ratings,
                    guest_feedback: g.guest_feedback
                }));

                return {
                    ...b,
                    guests: bGuests,
                    BookingItems: (items || [])
                    .filter(i => i.bookingId === b.id)
                    .sort((a, b) => {
                        const orderA = a.options?.order;
                        const orderB = b.options?.order;
                        
                        // Ưu tiên sắp xếp theo order trong options nếu có
                        if (typeof orderA === 'number' && typeof orderB === 'number') {
                            if (orderA !== orderB) return orderA - orderB;
                        } else if (typeof orderA === 'number') {
                            return -1;
                        } else if (typeof orderB === 'number') {
                            return 1;
                        }

                        // Nếu không có, dùng logic cũ
                        const matchA = a.id.match(/-item(\d+)$/);
                        const matchB = b.id.match(/-item(\d+)$/);
                        
                        if (matchA && matchB) {
                            return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
                        } else if (matchA && !matchB) {
                            return 1; // a is add-on, b is original -> a comes after b
                        } else if (!matchA && matchB) {
                            return -1; // a is original, b is add-on -> a comes before b
                        }
                        
                        // Both are original items, fallback to localeCompare
                        return a.id.localeCompare(b.id);
                    })
                    .map(i => {
                        const sId = String(i.serviceId || '').trim().toLowerCase();
                        const svcInfo = servicesMap[sId];
                        
                        // Ưu tiên duration từ database nếu có
                        let finalDuration = svcInfo?.duration !== undefined ? svcInfo.duration : 0;
                        if (sId.toLowerCase().includes('nhs0000')) {
                            finalDuration = 1;
                        } else if (!svcInfo) {
                            console.warn(`[Dispatch] Service lookup failed for sId: "${sId}"; no catalog duration available.`);
                        }

                        // 🔥 VIP FIX: Lấy vipDuration/duration nếu có trong options
                        let parsedOptions: any = {};
                        try {
                            parsedOptions = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
                        } catch(e) {}

                        if (parsedOptions?.vipDuration) {
                            finalDuration = Number(parsedOptions.vipDuration);
                        } else if (parsedOptions?.duration) {
                            finalDuration = Number(parsedOptions.duration);
                        }

                        return {
                            ...i,
                            options: parsedOptions,
                            service_name: svcInfo?.name || `DV ${sId.toUpperCase()}`,
                            serviceName: svcInfo?.name || `DV ${sId.toUpperCase()}`, // Thêm camelCase cho đồng bộ
                            displayName: parsedOptions?.displayName || svcInfo?.name || `DV ${sId.toUpperCase()}`,
                            service_description: (b.source === 'VIP_MENU' || parsedOptions?.vipDuration || parsedOptions?.selectedSkills) ? '' : (svcInfo?.description || ''),
                            duration: finalDuration,
                            is_utility: svcInfo?.is_utility ?? (sId === 'nhs0900'), // ✅ is_utility, fallback legacy
                            min_ktv_required: svcInfo?.min_ktv_required ?? 1,
                            service_group: svcInfo?.service_group ?? 'MAIN',
                            timeStart: i.timeStart || null,
                            timeEnd: i.timeEnd || null,
                            status: i.status || 'NEW',
                            guestId: i.guest_id || null,
                        };
                    })
                };
            });
        }

        console.log(`📡 [Server] Fetched: ${bookings.length} bookings for ${date}`);
        bookings.forEach(b => {
            const totalDur = (b.BookingItems || []).reduce((acc: number, i: any) => acc + (i.duration || 0), 0);
            console.log(`  📋 ${b.billCode}: ${(b.BookingItems || []).length} services, Total Dur: ${totalDur}p`);
            if (b.BookingItems && b.BookingItems.length > 0) {
              console.log(`     - First Item: ${b.BookingItems[0].service_name}, dur=${b.BookingItems[0].duration}`);
            }
        });

        // 5b. KTV đánh giá quầy (KTVReviewReception).
        // ⚠️ Trước 11/09/2026 bảng này CHỈ có người ghi, không ai đọc: KTV chấm sao
        // + góp ý cho quầy ở màn Reward xong là nằm im trong DB, không màn nào
        // hiện. Gắn vào từng booking để thẻ Kanban hiện được ngay dưới thẻ.
        {
            const bookingIds = bookings.map((b: any) => b.id).filter(Boolean);
            if (bookingIds.length > 0) {
                const { data: rrRows, error: rrErr } = await supabase
                    .from('KTVReviewReception')
                    .select('ktv_id, booking_id, rating, note, images, created_at')
                    .in('booking_id', bookingIds);
                if (rrErr) {
                    // Không chặn cả bảng điều phối chỉ vì phần đánh giá hỏng.
                    console.error('[Dispatch] không đọc được đánh giá quầy:', rrErr.message);
                } else {
                    const theoBooking = new Map<string, any[]>();
                    (rrRows || []).forEach((r: any) => {
                        const k = String(r.booking_id);
                        if (!theoBooking.has(k)) theoBooking.set(k, []);
                        theoBooking.get(k)!.push(r);
                    });
                    bookings.forEach((b: any) => { b.ktvReviewsOfReception = theoBooking.get(String(b.id)) || []; });
                }
            }
        }

        // 5c. KTV bấm "Khách về sớm" / "Khẩn cấp" trên app (StaffNotifications).
        // `options.counterLog` chỉ ghi hai nút này từ 14/09/2026 — đơn trước đó
        // trên thẻ chỉ còn "Tạm dừng", mất lý do. Bảng thông báo là nơi duy nhất
        // còn giữ KTV đã bấm gì, nên gắn vào từng booking để thẻ trộn vào nhật ký
        // (KanbanBoard.counterLog.logic.ts). Với đơn mới đây cũng là lưới an toàn:
        // logKtvReport cố ý không throw, lỗi là mất dòng trong im lặng.
        {
            const bookingIds = bookings.map((b: any) => b.id).filter(Boolean);
            if (bookingIds.length > 0) {
                const { data: rpRows, error: rpErr } = await supabase
                    .from('StaffNotifications')
                    .select('bookingId, type, employeeId, createdAt, message')
                    .in('bookingId', bookingIds)
                    .in('type', ['EARLY_EXIT', 'EMERGENCY']);
                if (rpErr) {
                    console.error('[Dispatch] không đọc được báo của KTV:', rpErr.message);
                } else {
                    const theoBooking = new Map<string, any[]>();
                    (rpRows || []).forEach((r: any) => {
                        const k = String(r.bookingId);
                        if (!theoBooking.has(k)) theoBooking.set(k, []);
                        theoBooking.get(k)!.push({ type: r.type, employeeId: r.employeeId, createdAt: r.createdAt, message: r.message });
                    });
                    bookings.forEach((b: any) => { b.ktvReports = theoBooking.get(String(b.id)) || []; });
                }
            }
        }

        // 6. Fetch Rooms, Beds, and Reminders — 🔧 EGRESS FIX: select specific columns
        const { data: rooms } = await supabase.from('Rooms').select('id, name, capacity, type, default_reminders, has_guests');
        const { data: beds } = await supabase.from('Beds').select('id, name, roomId');
        const { data: reminders } = await supabase.from('Reminders').select('id, content, order_index, is_active').eq('is_active', true).order('order_index', { ascending: true });
        const { data: configs } = await supabase.from('SystemConfigs').select('key, value');

        const transitionConfig = configs?.find((c: any) => c.key === 'room_transition_time' || c.key === 'thoi_gian_doi_phong');
        const roomTransitionTime = transitionConfig ? (parseInt(transitionConfig.value, 10) || 1) : 1;

        return {
            success: true,
            data: {
                staffs,
                turns,
                bookings,
                rooms: rooms || [],
                beds: beds || [],
                reminders: reminders || [],
                allServices: allServices || [],
                roomTransitionTime
            },
            // Gửi kèm log nếu có lỗi svc query
            _debugSvcCount: bookings.length > 0 ? bookings[0].BookingItems?.length : 0
        };
    } catch (error: any) {
        console.error('❌ [Server] getDispatchData error:', error);

        // 'Forbidden' ở màn điều phối gần như luôn là PHIÊN BỊ LẪN, không phải
        // quầy bị gỡ quyền: cookie JWT của Supabase khoá theo TÊN MÁY CHỦ và bỏ
        // qua cổng, nên mở app KTV ở localhost:3001 rồi bảng điều phối ở
        // localhost:57981 là dùng chung một phiên — ai đăng nhập sau đè lên trước.
        // Tab vẫn nhớ "tôi là dev" (sessionStorage, riêng từng tab) nhưng mọi lời
        // gọi server lại đi dưới danh nghĩa KTV kia.
        //
        // Trả kèm danh tính mà máy chủ đang thấy để màn hình nói được cho quầy
        // biết vì sao bảng trống, thay vì im lặng rồi in Forbidden ra console.
        if (String(error?.message) === 'Forbidden') {
            let danhTinhMayChu: string | null = null;
            try {
                const u = await requireBusinessUser();
                danhTinhMayChu = u?.techCode || u?.businessUserId || null;
            } catch { /* không tra ra thì thôi, vẫn báo được là bị lẫn */ }
            return { success: false, error: 'Forbidden', identityMismatch: danhTinhMayChu || '(không rõ)' };
        }

        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function processDispatch(bookingId: string, dispatchData: {
    status: string;
    technicianCode?: string | null;
    bedId?: string | null;
    roomName?: string | null;
    staffAssignments: any[];
    date: string;
    notes?: string;
    itemUpdates?: { 
        id: string, 
        roomName?: string | null, 
        bedId?: string | null, 
        technicianCodes?: string[] | string | null, 
        status?: string,
        segments?: any[],
        options: any 
    }[];
    guestUpdates?: {
        id: string;
        bedId?: string | null;
        roomId?: string | null;
        status?: string;
        notes?: string | null;
        focusArea?: string | null;
    }[];
    guestCount?: number;
    /** Mã KTV quầy đã bấm OK ở popup "chưa điểm danh" cho ĐÚNG lần gửi này (không lưu). */
    confirmedUncheckedKtvIds?: string[];
    confirmOverlap?: boolean;
    confirmedOverlapItemIds?: string[];
}) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 🔥 NORMALIZE KTV CODES TO UPPERCASE TO PREVENT CASE-SENSITIVITY BUGS
        if (dispatchData.technicianCode) {
            dispatchData.technicianCode = dispatchData.technicianCode.toUpperCase();
        }
        if (dispatchData.staffAssignments && Array.isArray(dispatchData.staffAssignments)) {
            dispatchData.staffAssignments.forEach(a => {
                if (a.ktvId) a.ktvId = String(a.ktvId).toUpperCase();
            });
        }
        if (dispatchData.itemUpdates && Array.isArray(dispatchData.itemUpdates)) {
            dispatchData.itemUpdates.forEach(u => {
                if (u.technicianCodes) {
                    if (Array.isArray(u.technicianCodes)) {
                        u.technicianCodes = u.technicianCodes.map(c => typeof c === 'string' ? c.toUpperCase() : c);
                    } else if (typeof u.technicianCodes === 'string') {
                        u.technicianCodes = u.technicianCodes.toUpperCase();
                    }
                }
                if (u.segments && Array.isArray(u.segments)) {
                    u.segments.forEach(s => {
                        if (s.ktvId) s.ktvId = String(s.ktvId).toUpperCase();
                    });
                }
            });
        }

        // 🔥 KTV NGOÀI KHÔNG TÀI KHOẢN (mở lại 15/09/2026)
        // Ô chọn gửi `NEW_EXT:<TÊN>` cho người ngoài chưa có dòng Staff → đổi thành mã
        // `EXT_` (dùng lại dòng cùng tên nếu có). Sau bước này MỌI mã phải có trong
        // Staff; mã lạ KHÔNG mang tiền tố vẫn bị trả lỗi như từ 12/09.
        const extError = await resolveNewExternalKtvIds(supabase, dispatchData);
        if (extError) return { success: false, error: extError };

        const { data: currentItems, error: currentItemsError } = await supabase.from('BookingItems')
            .select('id, segments, status, technicianCodes, options').eq('bookingId', bookingId);
        if (currentItemsError) throw currentItemsError;
        const liveSequentialItems = (currentItems || []).filter(i => isTwoSlotSequential(i.options)
            && ['PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED'].includes(i.status));
        const liveIds = new Set(liveSequentialItems.map(i => i.id));
        if ((currentItems || []).some(i => isTwoSlotSequential(i.options) && !['NEW','WAITING','PREPARING','READY','IN_PROGRESS','PAUSED'].includes(i.status)
            && dispatchData.itemUpdates?.some(update => update.id === i.id)))
            throw new Error('Dịch vụ đã hoàn tất; không thể điều phối lại');
        const liveSegments = liveSequentialItems.flatMap(i => typeof i.segments === 'string' ? JSON.parse(i.segments) : (i.segments || []));
        const aIds = new Set(liveSegments.filter(s => Number(s.sequenceSlot) === 1).map(s => s.ktvId));
        const bIds = new Set(liveSegments.filter(s => Number(s.sequenceSlot) === 2 && s.voided !== true).map(s => s.ktvId));
        const otherIds = new Set(dispatchData.staffAssignments.filter(a => !liveIds.has(a.bookingItemId)).map(a => a.ktvId));

        const allKtvIds = new Set<string>();
        if (dispatchData.technicianCode) allKtvIds.add(dispatchData.technicianCode);
        if (dispatchData.staffAssignments) dispatchData.staffAssignments.forEach(a => { if (a.ktvId) allKtvIds.add(a.ktvId) });
        if (dispatchData.itemUpdates) dispatchData.itemUpdates.forEach(u => {
            if (u.technicianCodes) {
                if (Array.isArray(u.technicianCodes)) u.technicianCodes.forEach(c => { if (c) allKtvIds.add(c) });
                else if (typeof u.technicianCodes === 'string') {
                    u.technicianCodes.split(',').forEach(c => {
                        const trimmed = c.trim();
                        if (trimmed) allKtvIds.add(trimmed);
                    });
                }
            }
        });
        const uniqueKtvIds = Array.from(allKtvIds).filter(id => id && (!aIds.has(id) || bIds.has(id) || otherIds.has(id)));

        const { data: knownStaffs } = uniqueKtvIds.length > 0
            ? await supabase.from('Staff').select('id, full_name, work_type').in('id', uniqueKtvIds)
            : { data: [] as { id: string; full_name: string | null; work_type: string | null }[] };
        const knownStaffById = new Map((knownStaffs || []).map(st => [st.id, st]));
        const unknownKtvIds = uniqueKtvIds.filter(id => !knownStaffById.has(id));
        if (unknownKtvIds.length > 0) {
            return {
                success: false,
                error: `Không thể điều phối: KTV [${unknownKtvIds.join(', ')}] chưa có tài khoản. Vào Admin → Nhân viên tạo KTV (loại C nếu là cộng tác viên) rồi chọn lại từ danh sách.`
            };
        }

        // 🔥 KIỂM TRA ĐIỂM DANH — HỎI XÁC NHẬN thay vì chặn (chốt 14/09/2026, mọi loại KTV)
        // KTV chưa điểm danh hôm nay (`KTVAttendance`) hoặc đang `off` trong sổ tua → trả
        // `NEED_CHECKIN_CONFIRM`; quầy bấm OK thì gửi lại kèm `confirmedUncheckedKtvIds`.
        // Hỏi lại ở MỖI lần gửi cho tới khi KTV bấm "Oria xin chào". Loại D không điểm
        // danh vẫn bị cron phạt vắng như cũ — popup nhắc quầy điều đó.
        // Trước 14/09: A/B/D không có dòng TurnQueue ≠ off là chặn cứng; loại C được miễn.
        const { data: turnRowsToday } = uniqueKtvIds.length > 0
            ? await supabase.from('TurnQueue').select('employee_id, status').eq('date', dispatchData.date).in('employee_id', uniqueKtvIds)
            : { data: [] as { employee_id: string; status: string }[] };
        const checkedInIds = await checkedInStaffIds(supabase, uniqueKtvIds, dispatchData.date);
        const needCheckinConfirm = findKtvsNeedingCheckinConfirm({
            ktvIds: uniqueKtvIds,
            staffById: knownStaffById,
            checkedInIds,
            turnStatusById: new Map((turnRowsToday || []).map(t => [t.employee_id, t.status])),
            confirmedIds: dispatchData.confirmedUncheckedKtvIds,
        });
        if (needCheckinConfirm.length > 0) {
            return {
                success: false,
                code: 'NEED_CHECKIN_CONFIRM' as const,
                ktvs: needCheckinConfirm,
                error: `KTV [${needCheckinConfirm.map(k => k.id).join(', ')}] chưa điểm danh hoặc đang tắt nhận đơn — cần quầy xác nhận.`,
            };
        }
        const ktvIdsWithoutTurnRow = uniqueKtvIds.filter(id => !(turnRowsToday || []).some(t => t.employee_id === id));

        // 🔥 PRE-PROCESSOR: Chống ghi đè mất thời gian đã chạy (Stale Data Overwrite)
        if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
            if (currentItems) {
                dispatchData.itemUpdates = dispatchData.itemUpdates.map(updateItem => {
                    const dbItem = currentItems.find(i => i.id === updateItem.id);
                    if (!dbItem) return updateItem;
                    
                    // 1. NGĂN LÙI TRẠNG THÁI CA ĐANG LÀM / ĐÃ XONG
                    if (updateItem.status && dbItem.status) {
                        const STATUS_WEIGHT: Record<string, number> = { 'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7 };
                        const dbWeight = STATUS_WEIGHT[dbItem.status] || 0;
                        let incomingWeight = STATUS_WEIGHT[updateItem.status] || 0;
                        
                        // 2. ÉP TRẠNG THÁI VỀ WAITING NẾU CHƯA CÓ KTV NHƯNG LẠI BỊ GÁN PREPARING
                        if (updateItem.status === 'PREPARING') {
                            const hasKtv = (updateItem.technicianCodes && updateItem.technicianCodes.length > 0) || (dbItem.technicianCodes && dbItem.technicianCodes.length > 0);
                            if (!hasKtv && dbWeight < 2) {
                                // Nếu chưa gán KTV và ở DB đang là NEW/WAITING -> Giữ nguyên WAITING
                                updateItem.status = 'WAITING';
                                incomingWeight = STATUS_WEIGHT[updateItem.status];
                            }
                        }

                        // Nếu DB đang ở trạng thái lớn hơn, không cho phép lùi
                        if (dbWeight > incomingWeight) {
                            updateItem.status = dbItem.status;
                        }
                    }

                    let dbSegs: any[] = [];
                    try { dbSegs = typeof dbItem.segments === 'string' ? JSON.parse(dbItem.segments) : (dbItem.segments || []); } catch {}
                    const conflict = ['PREPARING','READY','IN_PROGRESS','PAUSED'].includes(dbItem.status) ? null
                        : liveDispatchConflict(dbSegs, Array.isArray(updateItem.segments) ? updateItem.segments : dbSegs, dbItem.options, updateItem.options, dbItem.status);
                    if (conflict) throw new Error(conflict);
                    
                    if (updateItem.segments && Array.isArray(updateItem.segments)) {
                        updateItem.segments = updateItem.segments.map(incomingSeg => {
                            const dbSeg = dbSegs.find((s: any) => s.id === incomingSeg.id);
                            if (dbSeg) {
                                // Trộn lại các mốc thời gian thực tế từ DB để không bị xóa mất
                                return {
                                    ...incomingSeg,
                                    ...savedPlanFields(dbSeg, incomingSeg),
                                    actualStartTime: dbSeg.actualStartTime || incomingSeg.actualStartTime,
                                    actualEndTime: dbSeg.actualEndTime || incomingSeg.actualEndTime,
                                    feedbackTime: dbSeg.feedbackTime || incomingSeg.feedbackTime,
                                    reviewTime: dbSeg.reviewTime || incomingSeg.reviewTime
                                };
                            }
                            return incomingSeg;
                        });
                    }
                    return updateItem;
                });
            }
        }
        for (const item of dispatchData.itemUpdates || []) {
            if (!isTwoSlotSequential(item.options)) continue;
            const slots = (item.segments || []).filter(s => s.voided !== true && s.voided !== 'true');
            if (slots.length < 1 || slots.length > 2 || !slots.some(s => Number(s.sequenceSlot) === 1)
                || new Set(slots.map(s => Number(s.sequenceSlot))).size !== slots.length
                || new Set(slots.map(s => s.ktvId)).size !== slots.length
                || slots.some(s => ![1, 2].includes(Number(s.sequenceSlot)) || !s.id || !s.ktvId || !s.roomId || !s.bedId || !s.startTime
                    || !Number.isInteger(s.duration) || s.duration < 1 || s.duration > 600)) {
                return { success: false, error: 'Phân công nối tiếp cần A hợp lệ và tối đa một B, thời lượng mỗi lượt 1–600 phút.' };
            }
        }
        
        // 🚀 BẢO VỆ TRẠNG THÁI BOOKING: Nếu DB đang ở trạng thái cao hơn, không cho lùi
        const { data: currentBooking, error: currentBookingError } = await supabase.from('Bookings').select('status').eq('id', bookingId).single();
        if (currentBookingError || !currentBooking) throw currentBookingError || new Error('Không đọc được đơn.');
        if (currentBooking && currentBooking.status) {
            if (!dispatchData.status) {
                dispatchData.status = currentBooking.status;
            } else {
                const STATUS_WEIGHT: Record<string, number> = { 'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7 };
                const dbWeight = STATUS_WEIGHT[currentBooking.status] || 0;
                const incomingWeight = STATUS_WEIGHT[dispatchData.status] || 0;
                if (dbWeight > incomingWeight) {
                    dispatchData.status = currentBooking.status;
                }
            }
        }


        // 3.5 Fetch existing items BEFORE RPC to accurately detect NEW KTVs for notifications
        const { data: existingItemsBefore, error: existingItemsError } = await supabase.from('BookingItems').select('id, segments, guest_id').eq('bookingId', bookingId);
        if (existingItemsError || !existingItemsBefore) throw existingItemsError || new Error('Không đọc được dịch vụ.');
        const oldKtvIds = new Set<string>();
        (existingItemsBefore || []).forEach(item => {
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            segs.forEach((s: any) => { if (s.ktvId) oldKtvIds.add(s.ktvId); });
        });

        const guestPlan = await resolveGuestIdsForUpdate(supabase, bookingId, dispatchData.itemUpdates || [], existingItemsBefore);
        const guestIds = new Map(guestPlan.updatesToApply.map(update => [update.itemId, update.guestId]));
        dispatchData.itemUpdates = dispatchData.itemUpdates?.map(item => guestIds.has(item.id)
            ? { ...item, guest_id: guestIds.get(item.id) } : item);

        // GỌI RPC MỚI ĐỂ THỰC THI TOÀN BỘ TRANSACTION
        const { data, error } = await applyDispatchEdit(supabase, bookingId, 'DISPATCH', {
            ...dispatchData, status: dispatchData.status || 'PREPARING',
            newGuests: guestPlan.newGuests, turnStaffIds: ktvIdsWithoutTurnRow,
            staffAssignments: dispatchData.staffAssignments || [], itemUpdates: dispatchData.itemUpdates || []
        });

        if (error) {
            console.error('❌ [Server] RPC dispatch_confirm_booking error:', error);
            throw error;
        }

        if (data?.code === 'OVERLAP_CONFIRM_REQUIRED') return data;
        if (!data?.success) {
            console.error('❌ [Server] RPC failed internally:', data?.error);
            throw new Error(data?.error || 'Máy chủ chưa xác nhận lưu điều phối');
        }

        const notificationWarnings: string[] = [];
        try {
        notificationWarnings.push(...await notifyAdjustedDurations(bookingId, data.durationChanges));
        for (const item of liveSequentialItems) {
            const update = dispatchData.itemUpdates?.find(update => update.id === item.id);
            if (!update) continue;
            const stored = data.savedItems?.find((saved: any) => saved.id === item.id);
            const activeB = (segments: any) => parseKtvSegments(segments, true)
                .find((s: any) => Number(s.sequenceSlot) === 2 && s.voided !== true && s.voided !== 'true');
            const before = activeB(item.segments);
            const afterB = activeB(stored?.segments || update.segments);
            const oldOptions = parseKtvOptions(item.options);
            const newOptions = parseKtvOptions(stored?.options || update.options);
            const nameFor = (options: any, seg: any) => options.serviceNamesForKtvs?.[seg.ktvId] || options.displayName || 'dịch vụ';
            // B đã nhận thông báo "bỏ lượt B" qua notifyAdjustedDurations → không gửi thêm lần nữa.
            const alreadyToldRemoved = (data.durationChanges || []).some((c: any) => c.removedB && c.employeeId === before?.ktvId && c.itemId === item.id);
            if (before && before.ktvId !== afterB?.ktvId && !alreadyToldRemoved) {
                const notified = await createNotification({ bookingId, employeeId: before.ktvId, type: 'KTV_ORDER_CHANGED',
                    message: `Phân công lượt B (${nameFor(oldOptions, before)}) đã được chuyển khỏi bạn. Vui lòng kiểm tra ứng dụng.` });
                if (!notified) notificationWarnings.push(`Đã đổi phân công B, chưa báo được cho ${before.ktvId}.`);
            }
            if (!afterB) continue;
            const name = nameFor(newOptions, afterB);
            const changed = !before || before.ktvId !== afterB.ktvId || nameFor(oldOptions, before) !== name
                || ['startTime', 'endTime', 'duration', 'roomId', 'bedId'].some(key => String(before[key] || '') !== String(afterB[key] || ''));
            if (!changed) continue;
            const newlyAssigned = before?.ktvId !== afterB.ktvId;
            const notified = await createNotification({ bookingId, employeeId: afterB.ktvId,
                type: newlyAssigned ? 'KTV_NEW_ORDER' : 'KTV_ORDER_CHANGED',
                message: `${newlyAssigned ? 'Bạn được phân công' : 'Quầy cập nhật'} lượt B: ${name}, ${afterB.startTime}, ${afterB.duration} phút. Vui lòng kiểm tra ứng dụng.` });
            if (!notified) notificationWarnings.push(`Đã lưu phân công B (${afterB.ktvId}), chưa tạo được thông báo. Báo trực tiếp cho nhân viên.`);
        }

        // Guest writes now share the dispatch revision transaction.

        // 4. Send background push and realtime notification to KTVs
        if (dispatchData.staffAssignments && dispatchData.staffAssignments.length > 0) {
            const staffIds = dispatchData.staffAssignments.filter(a => !liveIds.has(a.bookingItemId)).map(a => a.ktvId).filter(Boolean);
            const uniqueStaffIds = Array.from(new Set(staffIds));
            
            for (const staffId of uniqueStaffIds) {
                // CHỈ gửi thông báo nếu là KTV mới hoặc đơn đang ở trạng thái chuyển đổi từ Pending
                const isNewKtv = !oldKtvIds.has(staffId);
                const isDispatchAction = dispatchData.status !== 'pending';
                
                if (!isNewKtv && !isDispatchAction) continue;

                let svcName = 'dịch vụ mới';
                let svcTime = '';
                
                const ktvItem = dispatchData.itemUpdates?.find((i: any) => 
                    i.technicianCodes && (Array.isArray(i.technicianCodes) ? i.technicianCodes.includes(staffId) : i.technicianCodes === staffId)
                );
                
                if (ktvItem) {
                    svcName = ktvItem.options?.serviceNamesForKtvs?.[staffId] || ktvItem.options?.displayName || 'dịch vụ mới';
                    const ktvSeg = ktvItem.segments?.find((s: any) => s.ktvId === staffId);
                    if (ktvSeg && ktvSeg.startTime) {
                        svcTime = ` lúc ${ktvSeg.startTime}`;
                    } else if (ktvItem.segments && ktvItem.segments.length > 0 && ktvItem.segments[0].startTime) {
                        svcTime = ` lúc ${ktvItem.segments[0].startTime}`;
                    }
                }

                const message = `Bạn được phân công: ${svcName}${svcTime}. Vui lòng kiểm tra ứng dụng.`;

                // Gửi thông báo chi tiết cho KTV với loại KTV_NEW_ORDER để vượt qua bộ lọc client
                const notified = await createNotification({
                    bookingId: bookingId,
                    employeeId: String(staffId),
                    type: 'KTV_NEW_ORDER',
                    message: message,
                });
                if (!notified) notificationWarnings.push(`Đã lưu phân công (${staffId}), chưa tạo được thông báo. Báo trực tiếp cho nhân viên.`);
            }
        }

        if (dispatchData.staffAssignments.some(a => !liveIds.has(a.bookingItemId))) {
            const { syncTurnsForDate } = await import('@/lib/turn-sync');
            await syncTurnsForDate(dispatchData.date);
        }

        } catch (error) {
            console.error('Dispatch committed; notification/queue sync failed:', error);
            notificationWarnings.push('Đã lưu điều phối; một số thông báo hoặc sổ tua chưa đồng bộ. Kiểm tra và báo trực tiếp cho nhân viên.');
        }

        // 🔄 ĐỒNG BỘ TIMELINE SÂU XUỐNG DB (OPTION B)
        // Removed destructive syncOrderTimelineToDb

        return { success: true, warnings: notificationWarnings, savedItems: data.savedItems as any[], revisions: data.revisions as Record<string, number>, durationChanges: (data.durationChanges || []) as any[] };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/** Manual actual-time corrections use the same locked version/audit as dispatch. */
export async function editDispatchActualTimes(bookingId: string, itemId: string, expectedRevision: number,
    times: { segmentId: string; actualStartTime: string | null; actualEndTime: string | null }[]) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const { data: item, error: readError } = await supabase.from('BookingItems').select('segments, options')
            .eq('id', itemId).eq('bookingId', bookingId).single();
        if (readError) throw readError;
        const segments = typeof item.segments === 'string' ? JSON.parse(item.segments) : item.segments;
        if (!Array.isArray(segments) || !Array.isArray(times) || new Set(times.map(t => t.segmentId)).size !== times.length
            || times.some(t => !segments.some(s => s.id === t.segmentId))) throw new Error('Chặng đã thay đổi; tải lại đơn');
        const stamp = (value: string | null) => {
            if (!value) return null;
            if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
                throw new Error('Giờ thực tế cần đúng dạng ISO, có múi giờ Z hoặc +07:00');
            return new Date(value).toISOString();
        };
        const updated = segments.map(seg => {
            const edit = times.find(t => t.segmentId === seg.id);
            if (!edit) return seg;
            const start = stamp(edit.actualStartTime), end = stamp(edit.actualEndTime);
            if ((seg.actualStartTime && !start) || (seg.actualEndTime && !end))
                throw new Error('Không xóa mốc giờ thực tế đã ghi nhận; chỉ chỉnh lại giờ');
            if (end && (!start || Date.parse(end) < Date.parse(start))) throw new Error('Giờ kết thúc phải sau giờ bắt đầu');
            if (seg.voided === true && (start !== stamp(seg.actualStartTime || null) || end !== stamp(seg.actualEndTime || null)))
                throw new Error('Không sửa giờ lượt đã được thay');
            if (seg.voided === true) return seg;
            return { ...seg, actualStartTime: start, actualEndTime: end };
        });
        const { error } = await applyDispatchEdit(supabase, bookingId, 'EDIT_ACTUAL_TIME', {
            itemUpdates: [{ id: itemId, options: { dispatchRevision: expectedRevision }, segments: updated }]
        });
        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không thể sửa giờ thực tế' };
    }
}

/** Ghi ý định nối tiếp khi A đã được điều phối, không chốt giờ A. */
export async function enableSequentialItem(bookingId: string, itemId: string, expectedRevision: number) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const { data, error } = await applyDispatchEdit(supabase, bookingId, 'ENABLE_SEQUENTIAL', { itemId, expectedRevision });
        if (error) throw error;
        return { success: true, revision: data?.revisions?.[itemId] as number | undefined };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không thể chọn nối tiếp' };
    }
}

/** Gán/sửa B có khóa, giữ nguyên giờ thực của A. */
export async function handoffSequentialKtv(input: {
    bookingId: string;
    itemId: string;
    toKtvId: string;
    plannedStartAt: string;
    durationMinutes: number;
    confirmOverlap: boolean;
    expectedRevision: number;
    metadata?: { serviceNamesForKtvs: Record<string, string>; notesForKtvs: Record<string, string> };
}) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const { data, error } = await applyDispatchEdit(supabase, input.bookingId, 'ASSIGN_B', input);
        if (error) throw error;
        if (data?.code === 'OVERLAP_CONFIRM_REQUIRED') return {
            success: false, code: 'OVERLAP_CONFIRM_REQUIRED' as const,
            referenceAt: data.referenceAt as string,
            referenceKind: data.referenceKind as 'actual' | 'planned',
        };
        if (!data?.success) throw new Error(data?.error || 'DB không xác nhận gán B');
        const notified = await createNotification({
            bookingId: input.bookingId,
            employeeId: input.toKtvId,
            type: 'KTV_NEW_ORDER',
            message: 'Bạn được phân công lượt B của dịch vụ nối tiếp. Vui lòng kiểm tra ứng dụng.',
        });
        return { success: true, warnings: notified ? [] : ['Đã lưu phân công B, chưa tạo được thông báo. Báo trực tiếp cho nhân viên.'] };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không thể bàn giao nối tiếp' };
    }
}

/** Fresh server copy of one item, so a rejected repeat can tell "already saved" from a real conflict. */
export async function getDispatchItemState(bookingId: string, itemId: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const { data, error } = await supabase.from('BookingItems').select('id, status, segments, options, technicianCodes')
            .eq('id', itemId).eq('bookingId', bookingId).single();
        if (error || !data) throw error || new Error('Không tìm thấy dịch vụ');
        return { success: true, item: { ...data, segments: parseKtvSegments(data.segments), options: parseKtvOptions(data.options) } };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không đọc được dịch vụ' };
    }
}

export async function finishSequentialAfterA(bookingId: string, itemId: string, expectedRevision: number) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const { error } = await applyDispatchEdit(supabase, bookingId, 'FINISH_AFTER_A', { itemId, expectedRevision });
        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không thể kết thúc sau A' };
    }
}


/**
 * Đổi mọi `NEW_EXT:<TÊN>` (KTV ngoài chưa có dòng Staff, quầy vừa thêm ở ô chọn)
 * thành mã `EXT_xxxxxx` thật, ghi thẳng vào `data`. Trả câu lỗi, hoặc `null`.
 *
 * Mở lại 15/09/2026 (plans/plan_mo_lai_ktv_ngoai_khong_tai_khoan.md) sau khi
 * 12/09 tắt vì tự sinh không kiểm soát. Nay có kiểm soát:
 *   · kiểm lại tên ở máy chủ (không tin client) — trùng KTV nhà thì từ chối;
 *   · cùng tên (so không dấu) → dùng lại dòng cũ và bật `ĐANG LÀM`, không sinh thêm;
 *   · hai máy quầy cùng thêm một tên → cùng chốt về một dòng, dòng thừa vừa tạo bị xoá.
 * Dùng chung cho `processDispatch` và `saveDraftDispatch` (lưu nháp ghi thẳng
 * `technicianCodes`, không qua kiểm tra nào khác).
 */
async function resolveNewExternalKtvIds(
    supabase: any,
    data: {
        technicianCode?: string | null;
        staffAssignments?: { ktvId?: string | null; ktvName?: string | null }[];
        itemUpdates?: { technicianCodes?: string[] | string | null; segments?: any[] }[];
    }
): Promise<string | null> {
    const tokens = new Set<string>();
    const scan = (id?: string | null) => { if (id && isNewExternalKtvToken(id)) tokens.add(String(id)); };
    scan(data.technicianCode);
    (data.staffAssignments || []).forEach(a => scan(a.ktvId));
    (data.itemUpdates || []).forEach(u => {
        if (Array.isArray(u.technicianCodes)) u.technicianCodes.forEach(c => scan(c));
        else if (typeof u.technicianCodes === 'string') u.technicianCodes.split(',').forEach(c => scan(c.trim()));
        (u.segments || []).forEach((s: any) => scan(s?.ktvId));
    });
    if (tokens.size === 0) return null;

    const { data: staffRows, error: staffErr } = await supabase.from('Staff').select('id, full_name, status');
    if (staffErr) return `Không đọc được danh sách KTV: ${staffErr.message}`;
    type StaffRow = { id: string; full_name?: string | null; status?: string | null };
    const rows: StaffRow[] = staffRows || [];

    const idByToken: Record<string, string> = {};
    const nameById: Record<string, string> = {};
    for (const token of Array.from(tokens)) {
        const name = externalNameOfToken(token);
        const problem = externalKtvNameProblem(name, rows);
        if (problem) return `Không thể thêm KTV ngoài "${name}": ${problem}`;

        let resolved: StaffRow;
        const existing = findExternalKtvByName(name, rows);
        if (existing) {
            if (existing.status !== 'ĐANG LÀM') {
                await supabase.from('Staff').update({ status: 'ĐANG LÀM' }).eq('id', existing.id);
                existing.status = 'ĐANG LÀM';
            }
            resolved = existing;
        } else {
            const newId = `EXT_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
            const { error: insErr } = await supabase.from('Staff')
                .insert({ id: newId, full_name: name, work_type: 'TYPE_C', status: 'ĐANG LÀM' });
            if (insErr) return `Không thêm được KTV ngoài "${name}": ${insErr.message}`;

            // Hai máy quầy cùng thêm một tên: đọc lại, cùng chốt dòng theo luật findExternalKtvByName.
            const { data: sameType } = await supabase.from('Staff').select('id, full_name, status').eq('work_type', 'TYPE_C');
            const winner = findExternalKtvByName(name, (sameType || []) as StaffRow[]);
            if (winner && winner.id !== newId) {
                await supabase.from('Staff').delete().eq('id', newId);
                resolved = winner;
            } else {
                resolved = { id: newId, full_name: name, status: 'ĐANG LÀM' };
            }
            rows.push(resolved);
        }
        idByToken[token] = resolved.id;
        nameById[resolved.id] = resolved.full_name || name;
    }

    const swap = (id: string) => idByToken[id] || id;
    if (data.technicianCode) data.technicianCode = swap(data.technicianCode);
    (data.staffAssignments || []).forEach(a => {
        if (a.ktvId && idByToken[a.ktvId]) { a.ktvId = idByToken[a.ktvId]; a.ktvName = nameById[a.ktvId]; }
    });
    (data.itemUpdates || []).forEach(u => {
        if (Array.isArray(u.technicianCodes)) u.technicianCodes = u.technicianCodes.map(c => swap(c));
        else if (typeof u.technicianCodes === 'string') u.technicianCodes = u.technicianCodes.split(',').map(c => swap(c.trim())).join(',');
        (u.segments || []).forEach((s: any) => {
            if (s?.ktvId && idByToken[s.ktvId]) {
                s.ktvId = idByToken[s.ktvId];
                if (!s.ktvName || isNewExternalKtvToken(s.ktvName)) s.ktvName = nameById[s.ktvId];
            }
        });
    });
    return null;
}

export async function saveDraftDispatch(bookingId: string, dispatchData: {
    date?: string;
    confirmOverlap?: boolean;
    confirmedOverlapItemIds?: string[];
    technicianCode?: string | null;
    bedId: string | null;
    roomName: string | null;
    notes?: string;
    itemUpdates?: { 
        id: string, 
        roomName?: string | null, 
        bedId?: string | null, 
        technicianCodes?: string[] | string | null, 
        segments?: any[],
        status?: string,
        options: any 
    }[];
}) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 🔥 NORMALIZE KTV CODES TO UPPERCASE TO PREVENT CASE-SENSITIVITY BUGS
        if (dispatchData.technicianCode) {
            dispatchData.technicianCode = dispatchData.technicianCode.toUpperCase();
        }
        if (dispatchData.itemUpdates && Array.isArray(dispatchData.itemUpdates)) {
            dispatchData.itemUpdates.forEach(u => {
                if (u.technicianCodes) {
                    if (Array.isArray(u.technicianCodes)) {
                        u.technicianCodes = u.technicianCodes.map(c => typeof c === 'string' ? c.trim().toUpperCase() : c);
                    } else if (typeof u.technicianCodes === 'string') {
                        u.technicianCodes = u.technicianCodes.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
                    }
                }
                if (u.segments && Array.isArray(u.segments)) {
                    u.segments.forEach(s => {
                        if (s.ktvId) s.ktvId = String(s.ktvId).toUpperCase();
                    });
                }
            });
        }

        // KTV ngoài vừa thêm ở ô chọn (`NEW_EXT:<TÊN>`) → mã EXT_ thật trước khi ghi xuống đơn.
        const extError = await resolveNewExternalKtvIds(supabase, dispatchData);
        if (extError) return { success: false, error: extError };

        let currentItems: any[] | null = null;
        let currentGuests: any[] | null = null;
        let newGuests: any[] = [];

        // 🔥 PRE-PROCESSOR: Chống ghi đè mất thời gian đã chạy (Stale Data Overwrite)
        if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
            const { data: cItems, error: cItemsError } = await supabase.from('BookingItems').select('id, segments, status, technicianCodes, guest_id, options').eq('bookingId', bookingId);
            if (cItemsError) throw cItemsError;
            const { data: cGuests } = await supabase.from('BookingGuests').select('id').eq('booking_id', bookingId);
            currentItems = cItems;
            currentGuests = cGuests;
            
            const guestPlan = await resolveGuestIdsForUpdate(supabase, bookingId, dispatchData.itemUpdates, currentItems || []);
            newGuests = guestPlan.newGuests;
            const resolvedGuestIds = new Map(guestPlan.updatesToApply.map(update => [update.itemId, update.guestId]));
            dispatchData.itemUpdates = dispatchData.itemUpdates.map(item => resolvedGuestIds.has(item.id)
                ? { ...item, guest_id: resolvedGuestIds.get(item.id) } : item);

            if (currentItems) {
                dispatchData.itemUpdates = dispatchData.itemUpdates.map(updateItem => {
                    const dbItem = (currentItems || []).find(i => i.id === updateItem.id);
                    if (!dbItem) return updateItem;
                    
                    // 1. NGĂN LÙI TRẠNG THÁI CA ĐANG LÀM / ĐÃ XONG
                    if (updateItem.status && dbItem.status) {
                        const STATUS_WEIGHT: Record<string, number> = { 'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7 };
                        const dbWeight = STATUS_WEIGHT[dbItem.status] || 0;
                        let incomingWeight = STATUS_WEIGHT[updateItem.status] || 0;
                        
                        // 2. ÉP TRẠNG THÁI VỀ WAITING NẾU CHƯA CÓ KTV NHƯNG LẠI BỊ GÁN PREPARING
                        if (updateItem.status === 'PREPARING') {
                            const hasKtv = (updateItem.technicianCodes && updateItem.technicianCodes.length > 0) || (dbItem.technicianCodes && dbItem.technicianCodes.length > 0);
                            if (!hasKtv && dbWeight < 2) {
                                updateItem.status = 'WAITING';
                                incomingWeight = STATUS_WEIGHT[updateItem.status];
                            }
                        }

                        if (dbWeight > incomingWeight) {
                            updateItem.status = dbItem.status;
                        }
                    }

                    let dbSegs: any[] = [];
                    try { dbSegs = typeof dbItem.segments === 'string' ? JSON.parse(dbItem.segments) : (dbItem.segments || []); } catch {}
                    const conflict = ['PREPARING','READY','IN_PROGRESS','PAUSED'].includes(dbItem.status) ? null
                        : liveDispatchConflict(dbSegs, Array.isArray(updateItem.segments) ? updateItem.segments : dbSegs, dbItem.options, updateItem.options, dbItem.status);
                    if (conflict) throw new Error(conflict);
                    
                    // 3. NGĂN CẤM XÓA KTV ĐÃ BẮT ĐẦU LÀM
                    if (updateItem.technicianCodes !== undefined) {
                        const incomingTechs = Array.isArray(updateItem.technicianCodes) 
                            ? updateItem.technicianCodes 
                            : (typeof updateItem.technicianCodes === 'string' 
                                ? updateItem.technicianCodes.split(',').map(c => c.trim()).filter(Boolean) 
                                : []);
                        
                        const dbTechs = Array.isArray(dbItem.technicianCodes) 
                            ? dbItem.technicianCodes 
                            : (typeof dbItem.technicianCodes === 'string' 
                                ? dbItem.technicianCodes.split(',').map((c: string) => c.trim()).filter(Boolean) 
                                : []);

                        for (const techId of dbTechs) {
                            if (!incomingTechs.includes(techId)) {
                                // Kiểm tra xem KTV này đã start chưa
                                const dbSeg = dbSegs.find((s: any) => s.ktvId === techId && s.voided !== true && s.voided !== 'true' && (s.actualStartTime || s.actualEndTime));
                                if (dbSeg) {
                                    throw new Error(`[CẢNH BÁO] KTV ${techId} đã bắt đầu làm việc. Vui lòng ra bảng Kanban dùng nút "Dừng / Đổi Người" thay vì gỡ trực tiếp!`);
                                }
                            }
                        }
                    }
                    
                    if (updateItem.segments && Array.isArray(updateItem.segments)) {
                        updateItem.segments = updateItem.segments.map(incomingSeg => {
                            const dbSeg = dbSegs.find((s: any) => s.id === incomingSeg.id);
                            if (dbSeg) {
                                return {
                                    ...incomingSeg,
                                    ...savedPlanFields(dbSeg, incomingSeg),
                                    actualStartTime: dbSeg.actualStartTime || incomingSeg.actualStartTime,
                                    actualEndTime: dbSeg.actualEndTime || incomingSeg.actualEndTime,
                                    feedbackTime: dbSeg.feedbackTime || incomingSeg.feedbackTime,
                                    reviewTime: dbSeg.reviewTime || incomingSeg.reviewTime,
                                    startPhotoUrl: dbSeg.startPhotoUrl || incomingSeg.startPhotoUrl,
                                    guestSlipperPhotoUrl: dbSeg.guestSlipperPhotoUrl || incomingSeg.guestSlipperPhotoUrl
                                };
                            }
                            return incomingSeg;
                        });
                    }
                    return updateItem;
                });
            }
        }

        // Collect the whole draft; the RPC checks all revisions before any write.
        const finalItemUpdates: any[] = [];

        // 2. Update BookingItems (Dữ liệu chi tiết từng dịch vụ, không đổi status)
        if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
            for (const item of dispatchData.itemUpdates) {
                const itemOpts = typeof item.options === 'string' ? JSON.parse(item.options) : (item.options || {});
                const isChild = !!itemOpts.mergedIntoId;
                
                // 🔥 TRANSLATION: Gán guest_id của cha cho con nếu bị gộp
                let targetGuestId = (item as any).guest_id;
                if (!targetGuestId && isChild && currentItems) {
                    const parentId = itemOpts.mergedIntoId;
                    const dbParent = currentItems.find(i => i.id === parentId);
                    if (dbParent && dbParent.guest_id) {
                        targetGuestId = dbParent.guest_id;
                    }
                } else if (!targetGuestId && currentItems) {
                    const dbItem = currentItems.find(i => i.id === item.id);
                    if (dbItem && dbItem.guest_id) {
                        targetGuestId = dbItem.guest_id;
                    }
                }
                
                const technicianCodes = Array.isArray(item.technicianCodes) 
                    ? item.technicianCodes 
                    : (typeof item.technicianCodes === 'string' ? item.technicianCodes.split(',').map(c => c.trim()).filter(Boolean) : []);
                
                // 🔥 SỬA LỖI: Merge segments thông minh để KHÔNG overwrite actualStartTime từ UI bị stale
                let finalSegments = item.segments || [];
                if (currentItems) {
                    const dbItem = currentItems.find(i => i.id === item.id);
                    if (dbItem && dbItem.segments) {
                        let dbSegments: any[] = [];
                        try {
                            dbSegments = typeof dbItem.segments === 'string' ? JSON.parse(dbItem.segments) : dbItem.segments;
                        } catch (e) {}

                        if (Array.isArray(dbSegments) && dbSegments.length > 0) {
                            finalSegments = finalSegments.map((incomingSeg: any) => {
                                const existingSeg = dbSegments.find((s: any) => s.id === incomingSeg.id);
                                if (existingSeg) {
                                    return {
                                        ...incomingSeg,
                                        ...savedPlanFields(existingSeg, incomingSeg),
                                        actualStartTime: existingSeg.actualStartTime || incomingSeg.actualStartTime,
                                        actualEndTime: existingSeg.actualEndTime || incomingSeg.actualEndTime,
                                        feedbackTime: existingSeg.feedbackTime || incomingSeg.feedbackTime,
                                        startPhotoUrl: existingSeg.startPhotoUrl || incomingSeg.startPhotoUrl,
                                        guestSlipperPhotoUrl: existingSeg.guestSlipperPhotoUrl || incomingSeg.guestSlipperPhotoUrl,
                                        handoverPhotoUrl: existingSeg.handoverPhotoUrl || incomingSeg.handoverPhotoUrl,
                                        handoverPhotoUrls: existingSeg.handoverPhotoUrls || incomingSeg.handoverPhotoUrls
                                    };
                                }
                                return incomingSeg;
                            });
                        }
                    }
                }

                const updatePayload: any = { 
                    roomName: item.roomName,
                    bedId: item.bedId,
                    technicianCodes: technicianCodes,
                    segments: finalSegments,
                    options: item.options 
                };
                if (targetGuestId) {
                    updatePayload.guest_id = targetGuestId;
                }

                finalItemUpdates.push({ id: item.id, ...updatePayload });
            }
        }
        const { data: saved, error: saveError } = await applyDispatchEdit(supabase, bookingId, 'DRAFT', {
            ...dispatchData, newGuests, itemUpdates: finalItemUpdates
        });
        if (saveError) throw saveError;
        if (saved?.code === 'OVERLAP_CONFIRM_REQUIRED') return saved;
        if (!saved?.success) throw new Error('Máy chủ chưa xác nhận lưu nháp');

        const warnings: string[] = [];
        try {
        warnings.push(...await notifyAdjustedDurations(bookingId, saved.durationChanges));
        // Fetch bookingDate to sync turns correctly
        const { data: bData } = await supabase.from('Bookings').select('bookingDate').eq('id', bookingId).single();
        const hasNormalUpdate = dispatchData.itemUpdates?.some(update => {
            const current = currentItems?.find(item => item.id === update.id);
            return !current || !isTwoSlotSequential(current.options) || !['PREPARING','READY','IN_PROGRESS','PAUSED'].includes(current.status);
        });
        if (hasNormalUpdate && bData && bData.bookingDate) {
            const dateStr = bData.bookingDate.split('T')[0];
            const { syncTurnsForDate } = await import('@/lib/turn-sync');
            await syncTurnsForDate(dateStr);
        }

        } catch (error) {
            console.error('Dispatch saved; queue sync failed:', error);
            warnings.push('Đã lưu thay đổi; sổ tua chưa đồng bộ, vui lòng kiểm tra lại.');
        }
        return { success: true, warnings, savedItems: saved.savedItems as any[], revisions: saved.revisions as Record<string, number>, durationChanges: (saved.durationChanges || []) as any[] };
    } catch (error: any) {
        console.error('❌ [Server] saveDraftDispatch error:', error);
        return { success: false, error: error.message };
    }
}

/** Save one KTV row while preserving every other row in the database item. */
export async function saveDispatchStaffRow(bookingId: string, itemId: string, row: {
    ktvId: string; segments: any[]; noteForKtv?: string; serviceNameForKtv?: string;
}, expectedRevision: number, sequential: boolean, confirmedOverlap = false) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const { data: item, error: itemError } = await supabase.from('BookingItems')
            .select('id, status, segments, options, technicianCodes, roomName, bedId')
            .eq('id', itemId).eq('bookingId', bookingId).single();
        if (itemError || !item) throw itemError || new Error('Không tìm thấy dịch vụ');
        const options = parseKtvOptions(item.options);
        const oldSegments = parseKtvSegments(item.segments, true);
        const draft = ['NEW', 'WAITING'].includes(item.status) && !oldSegments.some((s: any) => s.actualStartTime || s.actualEndTime);
        if (!draft && Number(options.dispatchRevision || 0) !== expectedRevision) throw new Error('Ca đang chạy đã thay đổi; giữ bản đang sửa và kiểm tra trước khi lưu.');
        const incoming = row.segments.filter((s: any) => s.voided !== true && s.voided !== 'true');
        if (sequential && incoming.some((s: any) => Number(s.sequenceSlot) === 2)
            && !oldSegments.some((s: any) => Number(s.sequenceSlot) === 1 && s.voided !== true))
            throw new Error('Lưu hàng A trước khi lưu B');
        if (!row.ktvId || !incoming.length || new Set(incoming.map((s: any) => s.id)).size !== incoming.length
            || oldSegments.some((s: any) => s.ktvId === row.ktvId && s.voided !== true && s.voided !== 'true'
                && !incoming.some((next: any) => next.id === s.id))) throw new Error('Hàng nhân viên đã thay đổi; tải lại đơn');
        const firstIncoming = sequential ? incoming.find((s: any) => Number(s.sequenceSlot) === 1) : null;
        const replacedDraftA = ['NEW', 'WAITING'].includes(item.status) && !oldSegments.some((s: any) => s.actualStartTime || s.actualEndTime) && firstIncoming
            ? oldSegments.find((s: any) => Number(s.sequenceSlot) === 1)
                || (oldSegments.length === 1 && Number(oldSegments[0].sequenceSlot) !== 2 ? oldSegments[0] : null)
            : null;
        let segments = oldSegments.filter((s: any) => s.id !== replacedDraftA?.id || s.ktvId === row.ktvId);
        for (const next of incoming) {
            const old = oldSegments.find((s: any) => s.id === next.id);
            if (old?.ktvId !== undefined && old.ktvId !== row.ktvId) throw new Error('Chặng thuộc nhân viên khác');
            if (!old && !['NEW', 'WAITING'].includes(item.status)) throw new Error('Chặng đã được điều phối; tải lại đơn');
            const editable = !old?.actualStartTime && !old?.actualEndTime && old?.voided !== true && old?.voided !== 'true';
            const segment = old ? { ...old } : { id: next.id, ktvId: row.ktvId };
            if (editable) for (const key of ['roomId', 'bedId', 'startTime', 'endTime', 'duration', 'sequenceSlot']) segment[key] = next[key];
            if (!/^\d{2}:\d{2}$/.test(String(segment.startTime || '')) || !Number.isFinite(Number(segment.duration))
                || Number(segment.duration) <= 0 || Number(segment.duration) > 600) throw new Error('Giờ hoặc thời lượng nhân viên không hợp lệ');
            segments = old ? segments.map((s: any) => s.id === old.id ? segment : s) : [...segments, segment];
        }
        const techs = (Array.isArray(item.technicianCodes) ? item.technicianCodes : String(item.technicianCodes || '').split(',').filter(Boolean))
            .filter((code: string) => code !== replacedDraftA?.ktvId || segments.some((s: any) => s.ktvId === code));
        if (!techs.includes(row.ktvId)) techs.push(row.ktvId);
        const names = ktvMetadataMap(parseKtvOptions(options.serviceNamesForKtvs), [row], 'serviceNameForKtv');
        const notes = ktvMetadataMap(parseKtvOptions(options.notesForKtvs), [row], 'noteForKtv');
        const { data: booking, error: bookingError } = await supabase.from('Bookings')
            .select('roomName, bedId, notes').eq('id', bookingId).single();
        if (bookingError) throw bookingError;
        const enableAfterSave = sequential && !isTwoSlotSequential(options) && ['PREPARING', 'READY', 'IN_PROGRESS'].includes(item.status);
        const saved = await saveDraftDispatch(bookingId, {
            roomName: booking.roomName, bedId: booking.bedId, notes: booking.notes,
            confirmedOverlapItemIds: confirmedOverlap ? [itemId] : [],
            itemUpdates: [{ id: itemId, roomName: segments[0]?.roomId || item.roomName || null,
                bedId: segments[0]?.bedId || item.bedId || null, technicianCodes: techs, segments,
                options: { ...options, ...(sequential && !enableAfterSave ? { sequentialSlots: 2 } : {}),
                    serviceNamesForKtvs: names, notesForKtvs: notes } }]
        });
        if (!saved.success || !enableAfterSave) return saved;
        const enabled = await enableSequentialItem(bookingId, itemId, saved.revisions?.[itemId] ?? expectedRevision);
        if (!enabled.success) return { ...enabled, revisions: saved.revisions };
        return { success: true, revisions: { ...saved.revisions, [itemId]: enabled.revision } };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không lưu được nhân viên' };
    }
}

/** Save a newly staged A/B pair from one form action. Draft rows are one DB edit. */
export async function saveSequentialPair(bookingId: string, itemId: string, rows: {
    ktvId: string; segments: any[]; noteForKtv?: string; serviceNameForKtv?: string;
}[], expectedRevision: number, displayName?: string, confirmedOverlap = false) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        if (rows.length < 1 || rows.length > 2 || new Set(rows.map(row => row.ktvId)).size !== rows.length)
            throw new Error('Cần chọn A và tối đa một nhân viên B');
        const segments = rows.map((row, index) => {
            const seg = row.segments.find((s: any) => s.voided !== true && s.voided !== 'true');
            if (!row.ktvId || !seg?.id || !/^\d{2}:\d{2}$/.test(String(seg.startTime || ''))
                || !Number.isInteger(Number(seg.duration)) || Number(seg.duration) < 1 || Number(seg.duration) > 600)
                throw new Error('Giờ hoặc thời lượng A/B không hợp lệ');
            return { id: seg.id, ktvId: row.ktvId, sequenceSlot: index + 1, roomId: seg.roomId || null,
                bedId: seg.bedId || null, startTime: seg.startTime, endTime: seg.endTime, duration: Number(seg.duration) };
        });
        if (new Set(segments.map(seg => seg.id)).size !== segments.length) throw new Error('Trùng chặng A/B');
        const { data: item, error: itemError } = await supabase.from('BookingItems')
            .select('id, status, segments, options, roomName, bedId').eq('id', itemId).eq('bookingId', bookingId).single();
        if (itemError || !item) throw itemError || new Error('Không tìm thấy dịch vụ');
        const { data: booking, error: bookingError } = await supabase.from('Bookings')
            .select('roomName, bedId, notes, bookingDate').eq('id', bookingId).single();
        if (bookingError || !booking) throw bookingError || new Error('Không tìm thấy đơn');
        const options = parseKtvOptions(item.options);
        const oldSegments = parseKtvSegments(item.segments, true);
        const names = ktvMetadataMap(parseKtvOptions(options.serviceNamesForKtvs), rows, 'serviceNameForKtv');
        const notes = ktvMetadataMap(parseKtvOptions(options.notesForKtvs), rows, 'noteForKtv');
        const metadata = { serviceNamesForKtvs: names, notesForKtvs: notes };
        if (['NEW', 'WAITING'].includes(item.status) && !oldSegments.some((s: any) => s.actualStartTime || s.actualEndTime)) {
            return await saveDraftDispatch(bookingId, { roomName: booking.roomName, bedId: booking.bedId,
                notes: booking.notes, itemUpdates: [{ id: itemId, roomName: segments[0].roomId || item.roomName || null,
                    bedId: segments[0].bedId || item.bedId || null, technicianCodes: rows.map(row => row.ktvId), segments,
                    options: { ...options, ...metadata, sequentialSlots: 2, displayName: displayName || options.displayName } }] });
        }
        if (Number(options.dispatchRevision || 0) !== expectedRevision) throw new Error('Ca đang chạy đã thay đổi; giữ bản đang sửa và kiểm tra trước khi lưu.');
        if (!['PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED'].includes(item.status)) throw new Error('Ca đã chuyển trạng thái; không thể gán B');
        const oldA = oldSegments.find((seg: any) => Number(seg.sequenceSlot) === 1 && seg.voided !== true)
            || (oldSegments.length === 1 ? oldSegments[0] : null);
        if (!oldA || oldA.id !== segments[0].id || oldA.ktvId !== segments[0].ktvId)
            throw new Error('A đang điều phối khác bản nháp; dùng thao tác Đổi KTV cho ca đang chạy');
        let revision = Number(options.dispatchRevision || 0);
        if (['roomId', 'bedId', 'startTime', 'endTime', 'duration'].some(key => String(oldA[key] ?? '') !== String((segments[0] as any)[key] ?? ''))) {
            if (oldA.actualStartTime || oldA.actualEndTime) throw new Error('A đã bắt đầu; không sửa kế hoạch đang chạy');
            const savedA=await saveDispatchStaffRow(bookingId,itemId,rows[0],revision,true,confirmedOverlap);
            if (!savedA.success) return savedA;
            revision=savedA.revisions?.[itemId] ?? revision;
            options.sequentialSlots=2;
        }
        if (!isTwoSlotSequential(options)) {
            const enabled = await applyDispatchEdit(supabase, bookingId, 'ENABLE_SEQUENTIAL', { itemId, expectedRevision: revision });
            if (enabled.error || !enabled.data?.success) throw enabled.error || new Error('Không thể bật nối tiếp');
            revision = Number(enabled.data.revisions?.[itemId] ?? revision);
        }
        if (segments.length === 1) return { success: true, revisions: { [itemId]: revision } };
        const day = String(booking.bookingDate || '').slice(0, 10);
        let startMs = Date.parse(`${day}T${segments[1].startTime}:00+07:00`);
        if (!Number.isFinite(startMs)) throw new Error('Ngày giờ B không hợp lệ');
        if (segments[1].startTime < segments[0].startTime) startMs += 86400000;
        const { data, error } = await applyDispatchEdit(supabase, bookingId, 'ASSIGN_B', {
            itemId, expectedRevision: revision, bookingId, toKtvId: segments[1].ktvId,
            plannedStartAt: new Date(startMs).toISOString(), durationMinutes: segments[1].duration,
            confirmOverlap: confirmedOverlap, metadata,
        });
        if (error) return { success: false, error: error.message, revisions: { [itemId]: revision } };
        if (data?.code === 'OVERLAP_CONFIRM_REQUIRED') return { ...data, revisions: { [itemId]: revision } };
        if (!data?.success) throw new Error(data?.error || 'Không lưu được B');
        const { data: stored, error: storedError } = await supabase.from('BookingItems')
            .select('segments').eq('id', itemId).eq('bookingId', bookingId).single();
        let notified = false;
        try {
            notified = await createNotification({ bookingId, employeeId: segments[1].ktvId,
                type: 'KTV_NEW_ORDER', message: 'Bạn được phân công lượt B của dịch vụ nối tiếp. Vui lòng kiểm tra ứng dụng.' });
        } catch (error) { console.error('B assignment notification failed:', error); }
        return { success: true, revisions: { [itemId]: data.revisions?.[itemId] },
            savedSegments: !storedError && stored ? parseKtvSegments(stored.segments) : undefined,
            warnings: notified ? [] : ['Đã lưu B nhưng chưa gửi được thông báo; vui lòng báo trực tiếp cho nhân viên.'] };
    } catch (error: any) {
        return { success: false, error: error.message || 'Không lưu được A/B' };
    }
}

/** Save one item through the same atomic form commit used by global Save and Dispatch. */
export async function saveDispatchForm(bookingId: string, itemId: string, rows: {
    ktvId: string; segments: any[]; noteForKtv?: string; serviceNameForKtv?: string;
}[], expectedRevision: number, sequential: boolean, displayName?: string, confirmedOverlap = false) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        const activeRows = rows.filter(row => row.ktvId && row.segments.some(seg => seg.voided !== true && seg.voided !== 'true'));
        if (new Set(activeRows.map(row => row.ktvId)).size !== activeRows.length || (sequential && activeRows.length > 2))
            throw new Error('Danh sách nhân viên không hợp lệ');
        const { data: item, error } = await supabase.from('BookingItems').select('id,status,segments,options,roomName,bedId')
            .eq('id',itemId).eq('bookingId',bookingId).single();
        if (error || !item) throw error || new Error('Không tìm thấy dịch vụ');
        const { data: booking, error: bookingError } = await supabase.from('Bookings').select('roomName,bedId,notes').eq('id',bookingId).single();
        if (bookingError || !booking) throw bookingError || new Error('Không tìm thấy đơn');
        const options=parseKtvOptions(item.options);
        if (Number(options.dispatchRevision || 0) !== expectedRevision) throw new Error('Ca đã thay đổi; bản đang sửa chưa được lưu. Tải lại và kiểm tra trước khi lưu.');
        const segments=activeRows.flatMap((row,index)=>row.segments.filter(seg=>seg.voided!==true && seg.voided!=='true')
            .map(seg=>({...seg,ktvId:row.ktvId,...(sequential ? {sequenceSlot:index+1} : {})})));
        const oldSegments=parseKtvSegments(item.segments,true);
        const oldA=oldSegments.find(seg=>Number(seg.sequenceSlot)===1 && seg.voided!==true && seg.voided!=='true')
            || (oldSegments.filter(seg=>seg.voided!==true && seg.voided!=='true').length===1
                ? oldSegments.find(seg=>seg.voided!==true && seg.voided!=='true') : undefined);
        const oldB=oldSegments.find(seg=>Number(seg.sequenceSlot)===2 && seg.voided!==true && seg.voided!=='true');
        const nextA=segments.find(seg=>seg.id===oldA?.id);
        const nextB=segments.find(seg=>Number(seg.sequenceSlot)===2);
        if (isTwoSlotSequential(options) && ['IN_PROGRESS','PAUSED'].includes(item.status) && oldA?.actualStartTime && !oldA.actualEndTime
            && oldB && !oldB.actualStartTime && nextA && nextB && Number(nextA.duration)!==Number(oldA.duration)) {
            if (nextA.id!==oldA.id || nextB.id!==oldB.id || nextA.ktvId!==oldA.ktvId || nextB.ktvId!==oldB.ktvId
                || nextA.roomId!==oldA.roomId || nextB.roomId!==oldB.roomId || nextA.bedId!==oldA.bedId || nextB.bedId!==oldB.bedId)
                throw new Error('Chỉ đổi thời lượng A và giờ B; nhân viên/phòng/giường phải giữ nguyên');
            const {data,error:pairError}=await supabase.rpc('dispatch_adjust_running_sequential_pair',{
                p_booking_id:bookingId,p_item_id:itemId,p_expected_revision:expectedRevision,
                p_a_minutes:Number(nextA.duration),p_b_start:nextB.startTime,p_b_minutes:Number(nextB.duration),
                p_metadata:{displayName:displayName || options.displayName,
                    serviceNamesForKtvs:ktvMetadataMap(parseKtvOptions(options.serviceNamesForKtvs),activeRows,'serviceNameForKtv'),
                    notesForKtvs:ktvMetadataMap(parseKtvOptions(options.notesForKtvs),activeRows,'noteForKtv')},
                p_actor:await currentCounterActor()
            });
            if (pairError || !data?.success) throw pairError || new Error(data?.error || 'Không lưu được giờ A/B');
            const savedSegments=parseKtvSegments(data.savedItem.segments);
            const savedA=savedSegments.find(seg=>seg.id===oldA.id);
            const savedB=savedSegments.find(seg=>seg.id===oldB.id);
            const warnings=await notifyAdjustedDurations(bookingId,[
                {employeeId:oldA.ktvId,minutes:Number(savedA?.duration || nextA.duration),startTime:savedA?.startTime,endTime:savedA?.endTime},
                ...(savedB ? [{employeeId:oldB.ktvId,minutes:Number(savedB.duration),startTime:savedB.startTime,endTime:savedB.endTime}] : [])]);
            return {success:true,savedItems:[data.savedItem],savedItem:data.savedItem,revisions:{[itemId]:data.revision},warnings,durationChanges:[{itemId}]};
        }
        const result=await saveDraftDispatch(bookingId,{roomName:booking.roomName,bedId:booking.bedId,notes:booking.notes,
            confirmedOverlapItemIds:confirmedOverlap ? [itemId] : [],itemUpdates:[{id:itemId,
                roomName:segments[0]?.roomId || item.roomName,bedId:segments[0]?.bedId || item.bedId,
                technicianCodes:activeRows.map(row=>row.ktvId),segments,
                options:{...options,dispatchRevision:expectedRevision,sequentialSlots:sequential ? 2 : options.sequentialSlots,
                    displayName:displayName || options.displayName,
                    serviceNamesForKtvs:ktvMetadataMap(parseKtvOptions(options.serviceNamesForKtvs),activeRows,'serviceNameForKtv'),
                    notesForKtvs:ktvMetadataMap(parseKtvOptions(options.notesForKtvs),activeRows,'noteForKtv')}}]});
        return {...result,savedItem:result.savedItems?.find((saved:any)=>saved.id===itemId)};
    } catch(error:any) { return {success:false,error:error.message || 'Không lưu được bản nháp'}; }
}

/**
 * Huỷ TOÀN BỘ đơn hàng.
 *
 * @param cancelCredit  'NONE'  = KTV mất sạch tiền, giờ tích luỹ và tua (mặc định).
 *                      'WORKED' = vẫn cho hưởng theo số phút đã làm thật.
 *   Giống hệt quy tắc của cancelBookingItem — lý do huỷ là chữ tự do do quầy gõ,
 *   KHÔNG được dùng để quyết định tiền; chỉ tham số này mới điều khiển.
 *   Xem plans/plan_tam_dung_huy_ket_thuc_som.md §5 bước 8.
 */
export async function cancelBooking(bookingId: string, date: string, cancelCredit: 'NONE' | 'WORKED' = 'NONE', reason: string = '') {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Cập nhật trạng thái các BookingItems chưa hoàn thành về CANCELLED.
        // ⏱️ Đồng thời CHỐT mốc kết thúc cho các chặng còn hở, nếu không thì
        // computeMinutes coi chặng là "không có mốc" và trả tiền theo giờ GÁN.
        // Đơn đang tạm dừng lấy mốc `pauseStart` chứ không lấy giờ hiện tại.
        const { data: itemsToCancel, error: itemsFetchError } = await supabase
            .from('BookingItems')
            .select('id, segments, status, pauseStart, options')
            .eq('bookingId', bookingId)
            .neq('status', 'DONE')
            .neq('status', 'CANCELLED');
        if (itemsFetchError) throw itemsFetchError;

        for (const item of itemsToCancel || []) {
            if (isTwoSlotSequential(item.options)) {
                await performSequentialLifecycle(supabase, item.id, { action: 'CANCEL', targetSlots: [1,2], reason, cancelCredit }, undefined, bookingId);
                continue;
            }

            let segs: any[] = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : ((item.segments as any) || []); } catch {}

            const isPausedItem = item.status === 'PAUSED' && !!(item as any).pauseStart;
            const endMark = isPausedItem ? (item as any).pauseStart : new Date().toISOString();

            let segmentsModified = false;
            segs.forEach((s: any) => {
                if (s.actualStartTime && !s.actualEndTime) {
                    closeOpenPause(s, endMark, 'CANCEL');
                    s.actualEndTime = endMark;
                    segmentsModified = true;
                }
                if (cancelCredit === 'NONE' && s.actualStartTime) {
                    voidSegment(s, endMark, 'CANCELLED_NO_CREDIT');
                    segmentsModified = true;
                }
            });

            let opts: any = (item as any).options;
            if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
            opts = opts || {};
            opts.cancelCredit = cancelCredit;
            if (reason) opts.cancelReason = reason;

            const payload: any = { status: 'CANCELLED', timeEnd: endMark, options: opts };
            if (segmentsModified) payload.segments = JSON.stringify(segs);
            if (isPausedItem) payload.pauseStart = null;

            const { error: itemError } = await supabase.from('BookingItems').update(payload).eq('id', item.id);
            if (itemError) throw itemError; // huỷ nửa vời còn tệ hơn báo lỗi
        }

        // 1. Cập nhật trạng thái Booking thành CANCELLED
        const { error: bError } = await supabase
            .from('Bookings')
            .update({
                status: 'CANCELLED',
                updatedAt: new Date().toISOString()
            })
            .eq('id', bookingId);

        if (bError) throw bError;

        // 2. Lấy thông tin trạng thái KTV trước khi giải phóng để quyết định có xóa Ledger không
        const { data: currentTurns } = await supabase
            .from('TurnQueue')
            .select('id, employee_id, status')
            .eq('current_order_id', bookingId)
            .eq('date', date);

        if (currentTurns && currentTurns.length > 0) {
            for (const turn of currentTurns) {
                // Scoped cancellation keeps started staff assigned until photos or existing debt quota releases them.
                if ((itemsToCancel || []).some(item => isTwoSlotSequential(item.options)
                    && parseKtvSegments(item.segments).some(seg => ktvMatchesSeg(seg.ktvId, turn.employee_id)
                        && seg.actualStartTime && !seg.handoverTime && seg.note !== 'CHANGED'))) continue;
                // ✅ Nếu CHƯA bắt đầu (assigned) mà bị hủy -> Xóa Ledger để giải phóng lượt tua cho KTV
                if (turn.status === 'assigned' || turn.status === 'ready' || turn.status === 'waiting') {
                    console.log(`✅ KTV ${turn.employee_id} được hoàn lượt tua do hủy đơn TRƯỚC KHI bắt đầu.`);
                    await supabase
                        .from('TurnLedger')
                        .delete()
                        .eq('date', date)
                        .eq('booking_id', bookingId)
                        .eq('employee_id', turn.employee_id);
                } else if (cancelCredit === 'NONE') {
                    // Đã bắt đầu làm nhưng huỷ mà KHÔNG cộng gì → tước luôn lượt tua.
                    // syncTurnsForDate đã lọc sẵn is_punished khỏi turns_completed.
                    console.log(`⛔ KTV ${turn.employee_id} mất lượt tua do huỷ đơn không cộng giờ.`);
                    await punishTurnIfIdle(supabase, {
                        bookingId,
                        employeeId: turn.employee_id,
                        date,
                    });
                } else {
                    // ⚠️ Quầy chọn cộng giờ đã làm -> GIỮ Ledger để tính tua/tiền cho KTV
                    console.log(`⚠️ KTV ${turn.employee_id} giữ nguyên lượt tua do quầy cho cộng giờ.`);
                }

                // 3. Giải phóng KTV trong TurnQueue
                const newStatus = turn.status === 'off' ? 'off' : 'waiting';
                const { error: tError } = await supabase
                    .from('TurnQueue')
                    .update({
                        status: newStatus,
                        current_order_id: null,
                        booking_item_id: null,
                        booking_item_ids: [],
                        room_id: null,
                        bed_id: null,
                        start_time: null,
                        estimated_end_time: null
                    })
                    .eq('id', turn.id);
                    
                if (tError) {
                    console.error('❌ [Server] TurnQueue cleanup error:', tError);
                }

                // 4. Đóng KtvAssignments rồi kéo đơn kế tiếp lên.
                // Thiếu bước này thì assignment còn treo ACTIVE/QUEUED và KTV
                // không được gán đơn mới dù TurnQueue đã về 'waiting'.
                await supabase
                    .from('KtvAssignments')
                    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
                    .eq('employee_id', turn.employee_id)
                    .eq('business_date', date)
                    .eq('booking_id', bookingId)
                    .in('status', ['ACTIVE', 'QUEUED', 'READY']);

                await supabase.rpc('promote_next_assignment', {
                    p_employee_id: turn.employee_id,
                    p_business_date: date,
                });
            }
        }

        // 🔄 ĐỒNG BỘ TIMELINE SÂU XUỐNG DB
        // Removed destructive syncOrderTimelineToDb

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] cancelBooking error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateBookingStatus(bookingId: string, newStatus: string, date: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Lấy trạng thái hiện tại để check rule
        const { data: bCurrent, error: bCurrentError } = await supabase.from('Bookings').select('status').eq('id', bookingId).single();
        if (bCurrentError || !bCurrent) throw bCurrentError || new Error('Không đọc được trạng thái đơn.');
        if (bCurrent && bCurrent.status) {
            const { canTransition } = await import('@/lib/dispatch-status');
            if (!canTransition(bCurrent.status, newStatus)) {
                return { success: false, error: `Lỗi: Không thể chuyển trạng thái từ ${bCurrent.status} sang ${newStatus}` };
            }
        }

        if (['CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED', 'CANCELLED', 'IN_PROGRESS', 'PAUSED'].includes(newStatus)) {
            const { sequentialSlotsComplete, isTwoSlotSequential } = await import('@/lib/dispatch-status');
            const { data: sequentialItems, error: sequentialError } = await supabase
                .from('BookingItems').select('id, status, options, segments').eq('bookingId', bookingId);
            if (sequentialError) throw sequentialError;
            if (['CANCELLED','IN_PROGRESS','PAUSED'].includes(newStatus)
                && (sequentialItems || []).some(item => isTwoSlotSequential(item.options) && item.status !== 'CANCELLED')) {
                throw new Error('Ca nối tiếp: chọn hàng A/B để bắt đầu, hoặc dùng nút Tạm dừng/Tiếp tục/Huỷ có chọn phạm vi.');
            }
            const unfinished = (sequentialItems || []).find((item: any) => {
                if (item.status === 'CANCELLED' || !isTwoSlotSequential(item.options)) return false;
                const segments = typeof item.segments === 'string' ? JSON.parse(item.segments) : item.segments;
                return !sequentialSlotsComplete(item.options, segments);
            });
            if (unfinished) throw new Error(`Dịch vụ ${unfinished.id} còn chờ lượt KTV nối tiếp; chưa thể chốt cả đơn.`);
        }

        // 1. Cập nhật trạng thái Booking
        const { error: bError } = await supabase
            .from('Bookings')
            .update({ 
                status: newStatus,
                updatedAt: new Date().toISOString()
            })
            .eq('id', bookingId);

        if (bError) throw bError;

        // Cập nhật trạng thái các BookingItems nếu Booking được hoàn thành / huỷ
        // 🔧 Cập nhật trạng thái các BookingItems nếu Booking được hoàn thành / huỷ
        if (['DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK'].includes(newStatus)) {
            // ⚠️ 'PAUSED' phải nằm trong danh sách này. Thiếu nó thì đơn đang tạm dừng
            // bị bỏ qua khi lễ tân kéo sang Dọn phòng / Huỷ → item kẹt 'PAUSED' vĩnh viễn
            // và recomputeBookingStatus kéo cả đơn về trạng thái sai.
            const { data: itemsToUpdate } = await supabase
                .from('BookingItems')
                .select('id, segments, status, pauseStart')
                .eq('bookingId', bookingId)
                .in('status', ['WAITING', 'PREPARING', 'IN_PROGRESS', 'PAUSED', 'CLEANING', 'FEEDBACK']);

            if (itemsToUpdate && itemsToUpdate.length > 0) {
                const { canTransition: canTransitionItem } = await import('@/lib/dispatch-status');
                for (const item of itemsToUpdate) {
                    let segs = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}

                    // ⏱️ Đơn đang tạm dừng thì mốc kết thúc là LÚC BẤM TẠM DỪNG, không phải bây giờ.
                    // Khoảng chờ giữa tạm dừng và lúc lễ tân chốt đơn không phải giờ làm.
                    const isPausedItem = (item as any).status === 'PAUSED' && !!(item as any).pauseStart;
                    const endMark = isPausedItem ? (item as any).pauseStart : new Date().toISOString();

                    let segmentsModified = false;
                    segs.forEach((s: any) => {
                        // Never stamp an end on a TAKEOVER segment whose KTV has not
                        // started yet: that KTV is an independent entity (rule 9.4)
                        // and may still start after this status change.
                        //
                        // ⚠️ Case WB-11092026-002: this loop stamped T007's fresh
                        // TAKEOVER segment at 21:08, the item became CLEANING, and the
                        // ledger paid T007's fixed 101p = 168.333đ before T007 pressed
                        // Start at 21:13 — leaving an end mark earlier than the start.
                        if (s.note === 'TAKEOVER' && !s.actualStartTime) return;
                        if (!s.actualEndTime) {
                            s.actualEndTime = endMark;
                            // Chốt số phút làm thực cho chặng đã tạm dừng — thiếu con số này thì
                            // KtvCommissionService trả về giờ GÁN và KTV được trả thừa tiền.
                            if (isPausedItem && s.actualStartTime && s.customCommissionDuration == null) {
                                const t1 = new Date(String(s.actualStartTime).replace(' ', 'T')).getTime();
                                const t2 = new Date(String(endMark).replace(' ', 'T')).getTime();
                                let worked = (Number.isFinite(t1) && Number.isFinite(t2) && t2 > t1)
                                    ? Math.round((t2 - t1) / 60000)
                                    : 0;
                                const assigned = Number(s.duration) || 0;
                                if (assigned > 0 && worked > assigned) worked = assigned;
                                s.customCommissionDuration = worked;
                            }
                            segmentsModified = true;
                        }
                    });

                    // Skip items already at higher status
                    const itemStatus = (item as any).status;
                    if (itemStatus && !canTransitionItem(itemStatus, newStatus)) {
                        // Still update segments if modified
                        if (segmentsModified) {
                            await supabase.from('BookingItems').update({ segments: JSON.stringify(segs) }).eq('id', item.id);
                        }
                        continue;
                    }

                    const payload: any = { status: newStatus };
                    if (segmentsModified) payload.segments = JSON.stringify(segs);
                    if (isPausedItem) payload.pauseStart = null; // gỡ cờ tạm dừng, tránh UI vẫn coi là đang dừng
                    if (newStatus === 'CLEANING' || newStatus === 'DONE' || newStatus === 'CANCELLED') {
                        payload.timeEnd = endMark;
                    }

                    await supabase.from('BookingItems').update(payload).eq('id', item.id);
                }
            }

            // 🔧 SMART BOOKING STATUS: Re-query ALL items để tính status chính xác (BỎ QUA UTILITY)
            const { data: allItemsAfterPartial } = await supabase
                .from('BookingItems')
                .select('id, status, serviceId, Services!BookingItems_serviceId_fkey(nameVN, is_utility)')
                .eq('bookingId', bookingId);
            
            if (allItemsAfterPartial && allItemsAfterPartial.length > 0) {
                const validItems = allItemsAfterPartial.filter((i: any) => {
                    const name = i.Services?.nameVN || '';
                    return !isUtilityService(i)
                        && !name.toLowerCase().includes('phong rieng');
                });
                // Tránh mảng rỗng nếu toàn bộ đơn là dịch vụ tiện ích
                const finalItems = validItems.length > 0 ? validItems : allItemsAfterPartial;
                const statuses = finalItems.map(i => i.status);

                const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
                let smartStatus = recomputeBookingStatus(statuses);
                
                // Keep the requested status if recomputed is DONE but we want a specific terminal status (e.g. FEEDBACK)
                if (smartStatus === 'DONE' && ['COMPLETED', 'DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK'].includes(newStatus)) {
                    smartStatus = newStatus;
                }
                
                // Override booking status nếu khác
                if (smartStatus !== newStatus) {
                    console.log(`🧠 [Smart Status] Booking ${bookingId}: Requested ${newStatus} but computed ${smartStatus} (some items still waiting)`);
                    await supabase.from('Bookings').update({ status: smartStatus, updatedAt: new Date().toISOString() }).eq('id', bookingId);
                }
            }
        } else if (newStatus === 'IN_PROGRESS') {
            const now = new Date().toISOString();
            // Cập nhật timeStart cho Bookings nếu chưa có
            await supabase.from('Bookings').update({ timeStart: now }).eq('id', bookingId).is('timeStart', null);

            // Cập nhật tất cả các items đang chờ thành IN_PROGRESS (CHỈ items chưa bắt đầu)
            const { error: itemError } = await supabase
                .from('BookingItems')
                .update({ status: 'IN_PROGRESS', timeStart: now })
                .eq('bookingId', bookingId)
                .in('status', ['WAITING', 'PREPARING', 'NEW']);
            if (itemError) console.error('❌ [Server] BookingItems start error:', itemError);

            // 🔥 FIX: Items đã từng IN_PROGRESS (bị kéo nhầm sang COMPLETED rồi kéo lại)
            // → Chỉ update status, KHÔNG ghi đè timeStart
            await supabase
                .from('BookingItems')
                .update({ status: 'IN_PROGRESS' })
                .eq('bookingId', bookingId)
                .in('status', ['COMPLETED', 'CLEANING'])
                .not('timeStart', 'is', null);

            // Cập nhật TurnQueue thành working + recalculate estimated_end_time
            const nowVN = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
            const { data: turnsToUpdate } = await supabase
                .from('TurnQueue')
                .select('id, employee_id, start_time, estimated_end_time')
                .eq('current_order_id', bookingId)
                .eq('date', date)
                .in('status', ['waiting', 'assigned', 'working']);

            for (const turn of turnsToUpdate || []) {
                const updatePayload: any = { status: 'working', start_time: nowVN };

                // 🔥 Recalculate estimated_end_time based on actual start time
                if (turn.start_time && turn.estimated_end_time) {
                    const newEnd = recalculateEstimatedEndTime(String(turn.start_time), String(turn.estimated_end_time), nowVN);
                    if (newEnd !== turn.estimated_end_time) {
                        updatePayload.estimated_end_time = newEnd;
                        console.log(`🔄 [TurnQueue] ${turn.employee_id}: Recalculated end ${turn.estimated_end_time} → ${updatePayload.estimated_end_time} (actual start: ${nowVN})`);
                    }
                }

                const { error: tError } = await supabase.from('TurnQueue').update(updatePayload).eq('id', turn.id);
                if (tError) console.error('❌ [Server] TurnQueue start error:', tError);
            }
        }

        // 🔧 CHỈ release KTV khi DONE hoặc CANCELLED. CLEANING/FEEDBACK = KTV vẫn bận!
        if (newStatus === 'DONE' || newStatus === 'CANCELLED') {
            // Re-check: chỉ giải phóng nếu KHÔNG còn items đang PREPARING/IN_PROGRESS
            const { data: remainingItems } = await supabase
                .from('BookingItems')
                .select('status')
                .eq('bookingId', bookingId)
                .in('status', ['PREPARING', 'IN_PROGRESS', 'NEW', 'WAITING']);
            
            const allReallyDone = !remainingItems || remainingItems.length === 0;
            
            if (allReallyDone) {
                // Lấy tất cả KTV đang làm đơn hàng này từ TurnQueue (cách cũ)
                const { data: turnsToRelease } = await supabase
                    .from('TurnQueue')
                    .select('id, employee_id, turns_completed, status')
                    .eq('current_order_id', bookingId)
                    .eq('date', date);

                // 🔥 BỔ SUNG: Lấy thêm danh sách từ KtvAssignments (ACTIVE state) để vét cạn các KTV bị kẹt
                const { data: activeAssignments } = await supabase
                    .from('KtvAssignments')
                    .select('employee_id')
                    .eq('booking_id', bookingId)
                    .eq('status', 'ACTIVE');

                const ktvsToRelease = new Set<string>();
                (turnsToRelease || []).forEach(t => { if (t.employee_id) ktvsToRelease.add(t.employee_id); });
                (activeAssignments || []).forEach(a => { if (a.employee_id) ktvsToRelease.add(a.employee_id); });

                if (ktvsToRelease.size > 0) {
                    for (const employeeId of Array.from(ktvsToRelease)) {
                        const turn = (turnsToRelease || []).find(t => t.employee_id === employeeId);

                        // Nếu hủy đơn khi đã bắt đầu làm (working) -> Xóa bản ghi TurnLedger (mất tua)
                        if (newStatus === 'CANCELLED' && turn && turn.status === 'working') {
                            console.log(`⚠️ KTV ${turn.id} mất tua do hủy đơn (status working).`);
                            await supabase
                                .from('TurnLedger')
                                .delete()
                                .eq('date', date)
                                .eq('booking_id', bookingId)
                                .eq('employee_id', employeeId);
                        }

                        // 1. Cập nhật KtvAssignments thành COMPLETED hoặc CANCELLED
                        const assignStatus = newStatus === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
                        await supabase
                            .from('KtvAssignments')
                            .update({ status: assignStatus, updated_at: new Date().toISOString() })
                            .eq('employee_id', employeeId)
                            .eq('booking_id', bookingId)
                            .eq('business_date', date)
                            .eq('status', 'ACTIVE'); // Khóa chặt theo đơn hàng và ngày làm việc

                        // 2. Gọi Auto-Handoff Engine
                        const { data: promoteData, error: promoteErr } = await supabase.rpc('promote_next_assignment', {
                            p_employee_id: employeeId,
                            p_business_date: date
                        });

                        if (promoteErr) console.error(`[Handoff] Error promoting KTV ${employeeId}:`, promoteErr);
                        else console.log(`[Handoff] KTV ${employeeId} auto-handoff result:`, promoteData);
                    }
                }
            } else {
                console.log(`🛡️ [Server] Booking ${bookingId}: Skipping TurnQueue release — ${remainingItems?.length} items still active`);
            }
        }

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] updateBookingStatus error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateBookingItemStatus(itemIds: string[], newStatus: string, date: string, bookingId: string, targetKtvIds?: string[], forceBackward: boolean = false, customStartTime?: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Lấy trạng thái hiện tại của items để check rule
        const { data: itemsCurrent, error: itemsCurrentError } = await supabase.from('BookingItems').select('id, status, segments, options').in('id', itemIds);
        if (itemsCurrentError || !itemsCurrent?.length) throw itemsCurrentError || new Error('Không đọc được dịch vụ.');
        const { canTransition, shouldHoldItemStatus, isTwoSlotSequential, sequentialSlotsComplete } = await import('@/lib/dispatch-status');
        if (itemsCurrent.some(item => isTwoSlotSequential(item.options)
            && (['CANCELLED','PAUSED'].includes(newStatus) || newStatus === 'IN_PROGRESS' && item.status === 'PAUSED'))) {
            throw new Error('Ca nối tiếp: dùng nút Tạm dừng/Tiếp tục hoặc Huỷ có chọn rõ A/B/cả hai.');
        }
        if (newStatus === 'IN_PROGRESS') {
            if (customStartTime && !Number.isFinite(Date.parse(customStartTime))) throw new Error('Giờ bắt đầu không hợp lệ.');
            for (const item of itemsCurrent.filter(item => isTwoSlotSequential(item.options))) {
                if (targetKtvIds?.length !== 1) throw new Error('Ca nối tiếp: chọn đúng hàng A/B để bắt đầu.');
                const own = parseKtvSegments(item.segments, true).filter(seg => seg.voided !== true && seg.voided !== 'true'
                    && ktvMatchesSeg(seg.ktvId, targetKtvIds[0]) && !seg.actualEndTime);
                if (!own.length || own.some(seg => seg.actualStartTime)) throw new Error('Ca nối tiếp: lượt đã bắt đầu, đã đóng hoặc đã đổi người; tải lại đơn.');
            }
        }
        // Items whose status really changed below — merged children follow only these.
        const statusChangedIds: string[] = [];
        
        // Filter: chỉ update items CÓ THỂ chuyển trạng thái, skip items đã ở bước cao hơn
        const updatableIds = (itemsCurrent || [])
            .filter(item => !item.status || canTransition(item.status, newStatus) || forceBackward)
            .map(item => item.id);
        
        const skippedItems = (itemsCurrent || [])
            .filter(item => item.status && !canTransition(item.status, newStatus) && !forceBackward);
        
        if (skippedItems.length > 0) {
            console.log(`[updateBookingItemStatus] Skipping ${skippedItems.length} items already at higher status:`, 
                skippedItems.map(i => `${i.id}:${i.status}`).join(', '));
        }
        
        for (const item of itemsCurrent || []) {
            let segs: any[] = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            const sequential = isTwoSlotSequential(item.options);
            if (sequential && newStatus === 'IN_PROGRESS' && (!targetKtvIds || targetKtvIds.length !== 1)) {
                throw new Error('Hãy chọn đúng hàng KTV để bắt đầu dịch vụ nối tiếp.');
            }
            if (sequential && ['CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED'].includes(newStatus)
                && (!targetKtvIds || targetKtvIds.length !== 1)
                && !sequentialSlotsComplete(item.options, segs)) {
                throw new Error('Dịch vụ còn lượt KTV nối tiếp chưa xong; hãy chọn hàng KTV hoặc bấm Hoàn thành.');
            }
            
            let segmentsModified = false;
            // Cập nhật actualStartTime khi bắt đầu làm
            if (['IN_PROGRESS'].includes(newStatus)) {
                segs.forEach((s: any) => {
                    if (targetKtvIds && targetKtvIds.length > 0) {
                        if (!targetKtvIds.some(id => ktvMatchesSeg(s.ktvId, id))) return;
                    }
                    if (!s.actualStartTime) {
                        s.actualStartTime = customStartTime || new Date().toISOString();
                        segmentsModified = true;
                    }
                });
            }

            // Xóa sạch thời gian nếu Lễ tân ÉP KÉO LÙI về Chuẩn Bị
            if (['PREPARING', 'WAITING', 'NEW'].includes(newStatus) && forceBackward) {
                // 🔥 HARD BLOCK: Ngăn chặn tuyệt đối việc xóa mất actualStartTime của KTV đã làm
                const startedKtvs = segs
                    .filter((s: any) => s.actualStartTime && (!targetKtvIds || targetKtvIds.length === 0 || targetKtvIds.includes(s.ktvId)))
                    .map((s: any) => s.ktvId || s.ktvName);
                
                if (startedKtvs.length > 0) {
                    throw new Error(`Không thể kéo thẻ lùi về "Chuẩn Bị" vì KTV [${startedKtvs.join(', ')}] đã bắt đầu làm. Để thêm/đổi người, vui lòng dùng tính năng "Cập Nhật KTV" hoặc "Tạm Dừng" ở menu chuột phải!`);
                }

                segs.forEach((s: any) => {
                    if (targetKtvIds && targetKtvIds.length > 0) {
                        if (!targetKtvIds.some(id => ktvMatchesSeg(s.ktvId, id))) return;
                    }
                    delete s.actualStartTime;
                    delete s.actualEndTime;
                    delete s.feedbackTime;
                    delete s.reviewTime;
                    segmentsModified = true;
                });
            }

            // Luôn đảm bảo có actualEndTime nếu đang chuyển sang trạng thái kết thúc
            if (['DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK', 'COMPLETED'].includes(newStatus)) {
                segs.forEach((s: any) => {
                    // Chỉ update nếu KTV này nằm trong targetKtvIds (nếu có)
                    if (targetKtvIds && targetKtvIds.length > 0) {
                        if (!targetKtvIds.some(id => ktvMatchesSeg(s.ktvId, id))) return;
                    }
                    if (sequential && !s.actualStartTime) return;
                    if (!s.actualEndTime) {
                        s.actualEndTime = new Date().toISOString();
                        segmentsModified = true;
                    }
                    // 🔥 FIX: Nếu chuyển sang FEEDBACK hoặc DONE, phải có feedbackTime thì Kanban mới chịu nhảy cột
                    if (['FEEDBACK', 'DONE'].includes(newStatus) && !s.feedbackTime) {
                        s.feedbackTime = new Date().toISOString();
                        segmentsModified = true;
                    }
                });
            }
            
            // Chỉ update status nếu được phép chuyển đổi.
            // One KTV's card finishing must not finish a service another KTV is still
            // on (sequence / takeover): close that KTV's segments only, keep the status.
            const holdStatus = shouldHoldItemStatus(segs, newStatus, targetKtvIds)
                || (sequential && ['CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED'].includes(newStatus)
                    && !sequentialSlotsComplete(item.options, segs));
            if (holdStatus) {
                console.log(`🛡️ [updateBookingItemStatus] ${item.id}: ${targetKtvIds?.join(',')} → ${newStatus}, but another KTV segment is still open → keep status ${item.status}`);
            }
            const isUpdatable = updatableIds.includes(item.id) && !holdStatus;
            if (isUpdatable) statusChangedIds.push(item.id);
            const payload: any = {};
            
            if (isUpdatable) {
                payload.status = newStatus;
                if (['CLEANING', 'DONE', 'CANCELLED', 'COMPLETED'].includes(newStatus)) {
                    payload.timeEnd = new Date().toISOString();
                }
            }
            
            if (segmentsModified) {
                payload.segments = JSON.stringify(segs);
            }
            
            if (Object.keys(payload).length > 0) {
                const { error: itemError } = await supabase.from('BookingItems').update(payload).eq('id', item.id);
                if (itemError) throw itemError;
            }
        }

        // 🔥 SYNC CHILD ITEMS: Khi parent merged service đổi status, child phải đổi theo
        // Nếu không, recomputeBookingStatus sẽ kéo booking status lùi vì child vẫn ở WAITING
        const { data: allBookingItems } = await supabase.from('BookingItems').select('id, options').eq('bookingId', bookingId);
        if (allBookingItems) {
            const childIdsToSync: string[] = [];
            for (const bi of allBookingItems) {
                let opts: any = {};
                try { opts = typeof bi.options === 'string' ? JSON.parse(bi.options) : (bi.options || {}); } catch {}
                // If this item is a child merged into one of the items we just updated
                if (opts.mergedIntoId && statusChangedIds.includes(opts.mergedIntoId)) {
                    childIdsToSync.push(bi.id);
                }
            }
            if (childIdsToSync.length > 0) {
                await supabase.from('BookingItems').update({ status: newStatus }).in('id', childIdsToSync);
            }
        }

        if (newStatus === 'IN_PROGRESS') {
            const now = customStartTime || new Date().toISOString();
            
            // Cập nhật timeStart cho Bookings nếu chưa có
            await supabase.from('Bookings').update({ timeStart: now }).eq('id', bookingId).is('timeStart', null);

            // 🔥 FIX: Chỉ set timeStart cho items CHƯA có timeStart (tránh ghi đè giờ KTV đã bấm)
            // Lấy danh sách items hiện tại để kiểm tra
            const { data: currentItems } = await supabase
                .from('BookingItems')
                .select('id, timeStart, status')
                .in('id', itemIds);

            const itemsNeedTimeStart = (currentItems || []).filter(i => !i.timeStart).map(i => i.id);
            const itemsAlreadyStarted = (currentItems || []).filter(i => i.timeStart).map(i => i.id);

            // Items chưa có timeStart → set cả status + timeStart
            if (itemsNeedTimeStart.length > 0) {
                await supabase
                    .from('BookingItems')
                    .update({ status: 'IN_PROGRESS', timeStart: now })
                    .in('id', itemsNeedTimeStart);
            }

            // Items đã có timeStart → CHỈ update status, bảo toàn timeStart gốc
            if (itemsAlreadyStarted.length > 0) {
                await supabase
                    .from('BookingItems')
                    .update({ status: 'IN_PROGRESS' })
                    .in('id', itemsAlreadyStarted);
            }

            // Cập nhật TurnQueue thành working + recalculate estimated_end_time
            const dateObj = new Date(now);
            const nowVN2 = dateObj.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
            let fetchQuery = supabase
                .from('TurnQueue')
                .select('id, employee_id, start_time, estimated_end_time')
                .eq('current_order_id', bookingId)
                .overlaps('booking_item_ids', itemIds)
                .eq('date', date)
                .in('status', ['waiting', 'assigned', 'ready', 'working']);

            if (targetKtvIds && targetKtvIds.length > 0) {
                fetchQuery = fetchQuery.in('employee_id', targetKtvIds);
            }
            const { data: turnsToUpdate2 } = await fetchQuery;

            for (const turn of turnsToUpdate2 || []) {
                const updatePayload: any = { status: 'working', start_time: nowVN2 };

                // 🔥 Recalculate estimated_end_time based on actual start time
                if (turn.start_time && turn.estimated_end_time) {
                    const newEnd = recalculateEstimatedEndTime(String(turn.start_time), String(turn.estimated_end_time), nowVN2);
                    if (newEnd !== turn.estimated_end_time) {
                        updatePayload.estimated_end_time = newEnd;
                        console.log(`🔄 [TurnQueue] ${turn.employee_id}: Recalculated end ${turn.estimated_end_time} → ${updatePayload.estimated_end_time} (actual start: ${nowVN2})`);
                    }
                }

                const { error: tErr } = await supabase.from('TurnQueue').update(updatePayload).eq('id', turn.id);
                if (tErr) console.error('❌ [Server] TurnQueue start error:', tErr);
            }
        }
        if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
            // Lấy tất cả KTV đang làm các item này
            let queryToRelease = supabase
                .from('TurnQueue')
                .select('id, turns_completed, status, booking_item_ids, employee_id')
                .eq('current_order_id', bookingId)
                .overlaps('booking_item_ids', itemIds)
                .eq('date', date);
                
            if (targetKtvIds && targetKtvIds.length > 0) {
                queryToRelease = queryToRelease.in('employee_id', targetKtvIds);
            }

            const { data: turnsToRelease } = await queryToRelease;

            if (turnsToRelease && turnsToRelease.length > 0) {
                for (const turn of turnsToRelease) {
                    const currentItemIds = turn.booking_item_ids || [];
                    const remainingItemIds = currentItemIds.filter((id: string) => !itemIds.includes(id));

                    if (remainingItemIds.length > 0) {
                        // KTV vẫn còn item khác đang làm trong bill này
                        await supabase
                            .from('TurnQueue')
                            .update({
                                booking_item_id: remainingItemIds.join(','),
                                booking_item_ids: remainingItemIds
                            })
                            .eq('id', turn.id);
                    } else {
                        // KTV đã xong tất cả item của họ
                        let newTurnsCompleted = turn.turns_completed || 0;
                        // Loại C (tài khoản thật) về 'waiting' như mọi người — quầy bật một lần dùng cả
                        // ngày, tắt tay ở Sổ tua khi họ về. Chỉ mã placeholder cũ mới bị đá về 'off'.
                        const newStatus = (turn.status === 'off' || isPlaceholderStaffId(turn.employee_id)) ? 'off' : 'waiting';
                        await supabase
                            .from('TurnQueue')
                            .update({
                                status: newStatus,
                                current_order_id: null,
                                booking_item_id: null,
                                booking_item_ids: [], // Set về mảng rỗng thay vì mảng chuỗi '{}'
                                start_time: null,
                                estimated_end_time: null,
                                turns_completed: newTurnsCompleted
                            })
                            .eq('id', turn.id);
                    }
                }
            }
        }
        
        // Auto-update Booking status based on remaining items
        const { data: allItems } = await supabase.from('BookingItems').select('status, serviceId, Services!BookingItems_serviceId_fkey(nameVN, is_utility)').eq('bookingId', bookingId);
        if (allItems && allItems.length > 0) {
            const validItems = allItems.filter((i: any) => {
                const name = i.Services?.nameVN || '';
                return !isUtilityService(i) 
                    && !name.toLowerCase().includes('phong rieng');
            });
            const finalItems = validItems.length > 0 ? validItems : allItems;
            const statuses = finalItems.map(i => i.status);
            const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
            let bStatus = recomputeBookingStatus(statuses);
            
            if (bStatus === 'DONE' && ['CLEANING', 'FEEDBACK', 'DONE', 'CANCELLED'].includes(newStatus)) {
                bStatus = newStatus;
            }
            
            await supabase.from('Bookings').update({ status: bStatus }).eq('id', bookingId);
        }

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        // 🔄 ĐỒNG BỘ TIMELINE SÂU XUỐNG DB
        // Removed destructive syncOrderTimelineToDb

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] updateBookingItemStatus error:', error);
        return { success: false, error: error.message };
    }
}

export async function createQuickBooking(data: { customerName: string; customerPhone?: string; customerEmail?: string; serviceIds: string[]; bookingDate: string; customerLang?: string; guestCount?: number; nationality?: string; isTestOrder?: boolean; vatRequested?: boolean; }) {
    await requirePermission('dispatch_board');
    return await BookingModificationService.createQuickBooking(data);
}

export async function updateBookingMeta(bookingId: string, data: { guestCount?: number; nationality?: string; customerGender?: string; paymentMethod?: string; }) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Update Bookings table
        const { error: bError } = await supabase
            .from('Bookings')
            .update(data)
            .eq('id', bookingId);
        
        if (bError) throw bError;

        // Sync nationality and gender to Customers table
        if (data.nationality || data.customerGender) {
            const { data: booking } = await supabase.from('Bookings').select('customerId').eq('id', bookingId).single();
            if (booking?.customerId) {
                const customerUpdate: Record<string, string> = {};
                if (data.nationality) customerUpdate.nationality = data.nationality;
                if (data.customerGender) customerUpdate.gender = data.customerGender;
                await supabase.from('Customers').update(customerUpdate).eq('id', booking.customerId);
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error('Lỗi cập nhật meta booking:', error);
        return { success: false, error: error.message };
    }
}

export async function addAddonServices(bookingId: string, items: { serviceId: string; qty: number; guestId?: string }[], adminId: string = 'ADMIN') {
    await requirePermission('dispatch_board');
    return await BookingModificationService.addAddonServices(bookingId, items, adminId);
}

export async function confirmAddonPayment(bookingId: string) {
    await requirePermission('dispatch_board');
    return await BookingModificationService.confirmAddonPayment(bookingId);
}

export async function removeBookingItem(bookingId: string, itemId: string) {
    await requirePermission('dispatch_board');
    return await BookingModificationService.removeBookingItem(bookingId, itemId);
}

export async function editBookingService(bookingId: string, itemId: string, newServiceId: string) {
    await requirePermission('dispatch_board');
    return await BookingModificationService.editBookingService(bookingId, itemId, newServiceId);
}

export async function submitCustomerRating(bookingId: string, rating: number, feedbackNote?: string, scaleShown?: number) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        // Thang của lần chấm này (thang màn quầy đang hiện; thiếu thì cấu hình). Kẹp 1..thang.
        const ratingScale = await resolveRatingScale(supabase, scaleShown);
        const clamped = clampRating(rating, ratingScale);
        if (clamped === null) throw new Error('Điểm đánh giá không hợp lệ');
        rating = clamped;

        const updatePayload: any = { 
            rating, 
            rating_scale: ratingScale,
            feedbackNote,
            updatedAt: new Date().toISOString() 
        };

        // ⚠️ Chấm sao ở đây PHẢI ghi xuống tới KTV, không chỉ dừng ở cấp bill.
        //
        // Trước đây hàm này chỉ ghi `Bookings.rating`. KTV không nhận được gì:
        // `itemRating` và `ktvRatings` vẫn trống. Sao đó thành mồ côi — nằm ở
        // bill mà không thuộc về ai.
        //
        // Hậu quả kép, đều gặp thật ngày 08/09 trên cây đơn TEST-260908-YNAY:
        //   · Người làm thật KHÔNG được ghi nhận (không lên sổ, không có thưởng).
        //   · Các chỗ tính tiền lại đi "mượn" con số mồ côi đó cho khách khác
        //     trong cùng bill — một khách chấm mà cả bill được thưởng.
        //
        // Nhật ký phân biệt rõ hai đường: bấm sao ở hàng CỦA TỪNG KHÁCH thì log
        // ghi "KTV T079 nhận đánh giá…", còn bấm ở hàng CẢ ĐƠN thì chỉ ghi
        // "Đơn hàng #… được đánh giá…" — không có tên ai.
        //
        // Nay hàng CẢ ĐƠN cũng gán sao cho đúng những KTV đã làm đơn đó, y như
        // `submitGuestRating` vẫn làm cho từng khách.
        const { data: ratingItems } = await supabase
            .from('BookingItems')
            .select('id, ktvRatings, technicianCodes, status')
            .eq('bookingId', bookingId);

        for (const item of ratingItems || []) {
            // Dịch vụ đã huỷ thì không gán sao — không ai làm thì không ai nhận.
            if (String(item.status || '').toUpperCase() === 'CANCELLED') continue;

            const ktvs = (item.technicianCodes || []).filter(Boolean);
            if (ktvs.length === 0) continue;

            const currentRatings: any = item.ktvRatings || {};
            for (const ktvId of ktvs) currentRatings[ktvId] = rating;

            const { error: rErr } = await supabase
                .from('BookingItems')
                .update({ itemRating: rating, ktvRatings: currentRatings, rating_scale: ratingScale })
                .eq('id', item.id);
            if (rErr) console.error('[submitCustomerRating] không gán được sao cho item', item.id, rErr.message);
        }

        // Có bản ghi khách thì ghi luôn xuống đó, để lần sau đọc ra đúng nguồn
        // GUEST thay vì phải lần xuống item.
        const { error: gErr } = await supabase
            .from('BookingGuests')
            .update({ rating, rating_scale: ratingScale, updated_at: new Date().toISOString() })
            .eq('booking_id', bookingId)
            .is('rating', null);
        if (gErr) console.warn('[submitCustomerRating] chưa ghi được sao xuống BookingGuests:', gErr.message);

        // 🛡️ SMART DONE: Chỉ set booking DONE nếu TẤT CẢ KTV đã bàn giao phòng xong
        // Nếu còn KTV chưa handover → giữ nguyên status, để handleReleaseKTV quyết định sau
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, status, segments, serviceId')
            .eq('bookingId', bookingId);

        if (items && items.length > 0) {
            // Lọc bỏ tiện ích (phòng riêng, etc.)
            const serviceItems = items.filter((i: any) => {
                const sId = String(i.serviceId || '').toUpperCase();
                return sId !== 'NHS0900';
            });
            const checkItems = serviceItems.length > 0 ? serviceItems : items;

            let allKTVsHandovered = true;
            for (const item of checkItems) {
                let segs: any[] = [];
                try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []); } catch { segs = []; }
                const startedSegs = segs.filter((s: any) => !!s.actualStartTime && !!s.ktvId);
                if (startedSegs.length > 0 && !startedSegs.every((s: any) => !!s.handoverTime)) {
                    allKTVsHandovered = false;
                    break;
                }
            }

            if (allKTVsHandovered) {
                // Tất cả KTV đã bàn giao → an toàn set DONE
                for (const item of checkItems) {
                    if (item.status !== 'DONE') {
                        let segs: any[] = [];
                        try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []); } catch { segs = []; }
                        const startedSegs = segs.filter((s: any) => !!s.actualStartTime);
                        const allSegsDone = startedSegs.length > 0 && startedSegs.every((s: any) => !!s.actualEndTime);
                        if (allSegsDone) {
                            await supabase.from('BookingItems').update({ status: 'DONE' }).eq('id', item.id);
                        }
                    }
                }
                // Recompute booking status
                const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
                const { data: refreshedItems } = await supabase.from('BookingItems').select('status, serviceId, Services!BookingItems_serviceId_fkey(nameVN, is_utility)').eq('bookingId', bookingId);
                if (refreshedItems && refreshedItems.length > 0) {
                    const validItems = refreshedItems.filter((i: any) => !isUtilityService(i));
                    const finalItems = validItems.length > 0 ? validItems : refreshedItems;
                    const bStatus = recomputeBookingStatus(finalItems.map((i: any) => i.status));
                    updatePayload.status = bStatus;
                }
                console.log(`✅ [submitCustomerRating] All KTVs handovered → booking ${bookingId} → ${updatePayload.status}`);
            } else {
                console.log(`⏳ [submitCustomerRating] Some KTVs not yet handovered → keeping current status for booking ${bookingId}`);
            }
        }

        const { error } = await supabase
            .from('Bookings')
            .update(updatePayload)
            .eq('id', bookingId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error("❌ [Server] submitCustomerRating error:", error);
        return { success: false, error: error.message };
    }
}


export async function splitBookingItem(bookingId: string, itemId: string, dur1: number, dur2: number, date: string, name1?: string, name2?: string) {
    await requirePermission('dispatch_board');
    return await BookingModificationService.splitBookingItem(bookingId, itemId, dur1, dur2, date, name1, name2);
}

/**
 * 🔄 ĐỒNG BỘ TIMELINE TOÀN BỘ ORDER XUỐNG DATABASE (OPTION B)
 * Tính toán giờ nối tiếp thực tế dựa trên actualStartTime và ghi đè vào segments của từng BookingItem.
 * Điều này đảm bảo KTV Dashboard và các API khác luôn thấy giờ chính xác nhất.
 */
export async function syncOrderTimelineToDb(bookingId: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) return;

        // 1. Fetch toàn bộ items của order
        const { data: items, error: fetchErr } = await supabase
            .from('BookingItems')
            .select('id, segments, duration, timeStart, serviceId, serviceName, options')
            .eq('bookingId', bookingId);
        
        if (fetchErr || !items || items.length === 0) return;

        // Helpers copy từ frontend (bản server-side)
        const formatToHourMinute = (isoString: string | null | undefined): string => {
            if (!isoString) return '--:--';
            if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;
            let parseString = isoString;
            if (!isoString.endsWith('Z') && !isoString.includes('+')) {
                parseString = isoString.replace(' ', 'T') + 'Z';
            }
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

        // 2. Gom tất cả segments vào mảng phẳng để tính toán
        const allSegments: any[] = [];
        items.forEach(item => {
            // Bỏ qua phòng riêng
            if (isUtilityService(item)) return; // Legacy fallback
            
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            
            segs.forEach((s: any) => {
                allSegments.push({
                    itemId: item.id,
                    ktvId: s.ktvId,
                    origStart: s.startTime || '',
                    duration: Number(s.duration) || Number(item.duration) || 60,
                    actualStartTime: s.actualStartTime,
                    actualEndTime: s.actualEndTime,
                    _originalSeg: s,
                    _parentItem: item
                });
            });
        });

        // Sắp xếp theo giờ xuất phát gốc
        allSegments.sort((a, b) => a.origStart.localeCompare(b.origStart));

        let currentMaxEndStr = '';
        let lastGroupStartTime = '';
        let lastGroupCalculatedStart = '';
        const updates = new Map<string, any[]>(); // itemId -> newSegments[]

        allSegments.forEach((seg, idx) => {
            let calculatedStart = seg.origStart;
            
            if (idx > 0) {
                if (seg.origStart === lastGroupStartTime) {
                    calculatedStart = lastGroupCalculatedStart;
                } else if (currentMaxEndStr) {
                    calculatedStart = currentMaxEndStr;
                }
            }

            // Ghi nhận sự thay đổi nếu có
            const newSeg = { ...seg._originalSeg, startTime: calculatedStart };
            if (!updates.has(seg.itemId)) updates.set(seg.itemId, []);
            updates.get(seg.itemId)!.push(newSeg);

            // Tính mốc kết thúc để gối đầu cho KTV sau
            const runtimeAnchor = seg.actualStartTime || calculatedStart;
            const ktvEnd = seg.actualEndTime || getDynamicEndTime(runtimeAnchor, seg.duration);

            if (seg.origStart !== lastGroupStartTime) {
                currentMaxEndStr = ktvEnd;
            } else {
                if (ktvEnd > currentMaxEndStr) currentMaxEndStr = ktvEnd;
            }

            lastGroupStartTime = seg.origStart;
            lastGroupCalculatedStart = calculatedStart;
        });

        // 3. Thực hiện update DB cho các item có thay đổi segments
        for (const [itemId, newSegs] of updates.entries()) {
            const originalItem = items.find(i => i.id === itemId);
            let oldSegsStr = '';
            try { oldSegsStr = typeof originalItem?.segments === 'string' ? originalItem.segments : JSON.stringify(originalItem?.segments || []); } catch {}
            
            const newSegsStr = JSON.stringify(newSegs);
            
            if (oldSegsStr !== newSegsStr) {
                console.log(`[syncOrderTimeline] Updating Item ${itemId}: shifted timeline detected.`);
                const payload: any = { segments: newSegsStr };
                
                // Nếu là segment đầu tiên của item này, cập nhật cả timeStart của item để đồng bộ
                if (newSegs.length > 0 && newSegs[0].startTime) {
                    payload.timeStart = newSegs[0].startTime;
                }

                await supabase.from('BookingItems').update(payload).eq('id', itemId);
            }
        }
    } catch (err) {
        console.error('❌ [Server] syncOrderTimelineToDb error:', err);
    }
}

export async function searchCustomers(query: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const safeQuery = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');

        const { data, error } = await supabase
            .from('Customers')
            .select('id, fullName, phone, email')
            .or(`fullName.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%`)
            .limit(10);

        if (error) throw error;
        return { success: true, data };
    } catch (err: any) {
        console.error('❌ [Server] searchCustomers error:', err.message);
        return { success: false, error: err.message };
    }
}

export async function updateSubOrderCustomerName(itemIds: string[], ktvIds: string[], newName: string) {
    try {
        await requirePermission('dispatch_board');
        if (!itemIds || itemIds.length === 0) return { success: true };

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data: items, error: fetchError } = await supabase
            .from('BookingItems')
            .select('id, options')
            .in('id', itemIds);
            
        if (fetchError || !items) throw fetchError;

        for (const item of items) {
            const currentOptions = item.options || {};
            const customNames = currentOptions.customNames || {};
            
            for (const ktvId of ktvIds) {
                if (newName && newName.trim() !== '') {
                    customNames[ktvId] = newName.trim();
                } else {
                    delete customNames[ktvId];
                }
            }
            
            const newOptions = { ...currentOptions, customNames };
            await supabase.from('BookingItems').update({ options: newOptions }).eq('id', item.id);
        }
        
        return { success: true };
    } catch (error) {
        console.error('❌ [Server] updateSubOrderCustomerName error:', error);
        return { success: false, error: 'Cannot update custom name' };
    }
}

export async function updateBookingCustomerName(bookingId: string, newName: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        
        const { error } = await supabase.from('Bookings').update({ customerName: newName }).eq('id', bookingId);
        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('❌ [Server] updateBookingCustomerName error:', error);
        return { success: false, error: 'Cannot update booking name' };
    }
}

/**
 * Đặt tên khách cho các đơn con vừa tách.
 *
 * RPC split_booking_into_sub_bookings đặt cứng nhãn "Khách A/B/C…". Quầy gõ tên
 * thật trong hộp xem trước thì ghi đè ở đây, để thẻ đơn và màn KTV gọi đúng tên
 * chứ không phải nhớ ai là "Khách B".
 */
export async function renameSubBookings(
    parentBookingId: string,
    renames: { suffix: string; name: string }[]
) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        for (const item of renames) {
            const newName = (item.name || '').trim();
            if (!newName || !item.suffix) continue;

            const subBookingId = `${parentBookingId}-${item.suffix}`;

            const { error: bookingErr } = await supabase
                .from('Bookings')
                .update({ customerName: newName })
                .eq('id', subBookingId);
            if (bookingErr) throw bookingErr;

            // guest_label là dòng "👨 …" KTV nhìn thấy trên máy, phải đổi theo.
            const { error: guestErr } = await supabase
                .from('BookingGuests')
                .update({ guest_label: newName, customer_name: newName })
                .eq('booking_id', subBookingId);
            if (guestErr) throw guestErr;
        }

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] renameSubBookings error:', error);
        return { success: false, error: error.message || 'Cannot rename sub bookings' };
    }
}

export async function unmergeServicesAction(
    parentSvcId: string,
    mergedServiceIds: string[],
    parentOptions: any,
    parentServiceName: string,
    resetSegments: any[]
) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Cập nhật các child item (xóa mergedIntoId khỏi options, clear assignments)
        const { data: childItems } = await supabase
            .from('BookingItems')
            .select('id, options')
            .in('id', mergedServiceIds);
            
        if (childItems) {
            for (const child of childItems) {
                const childOptions = child.options || {};
                delete childOptions.mergedIntoId;
                
                await supabase.from('BookingItems').update({
                    options: childOptions,
                    technicianCodes: [],
                    status: 'NEW',
                    segments: '[]'
                }).eq('id', child.id);
            }
        }
        
        // 2. Cập nhật parent item (xóa mergedServiceIds khỏi options)
        const updatedParentOptions = { ...(parentOptions || {}) };
        delete updatedParentOptions.mergedServiceIds;
        
        const { error: parentErr } = await supabase
            .from('BookingItems')
            .update({
                options: updatedParentOptions,
                segments: JSON.stringify(resetSegments)
            })
            .eq('id', parentSvcId);

        if (parentErr) throw parentErr;
        
        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] unmergeServicesAction error:', error);
        return { success: false, error: error.message };
    }
}

export async function submitGuestRating(guestId: string, rating: number, feedbackNote?: string, scaleShown?: number) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        // Thang của lần chấm này (thang màn quầy đang hiện; thiếu thì cấu hình). Kẹp 1..thang.
        const ratingScale = await resolveRatingScale(supabase, scaleShown);
        const clamped = clampRating(rating, ratingScale);
        if (clamped === null) throw new Error('Điểm đánh giá không hợp lệ');
        rating = clamped;

        // Update BookingGuests
        const { error: guestErr } = await supabase
            .from('BookingGuests')
            .update({
                rating,
                rating_scale: ratingScale,
                guest_feedback: feedbackNote || null,
                status: 'DONE',
                updated_at: new Date().toISOString()
            })
            .eq('id', guestId);
        
        if (guestErr) throw guestErr;

        // Also update the associated BookingItems to trigger Commission/Bonus flow
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, ktvRatings, technicianCodes')
            .eq('guest_id', guestId);

        if (items && items.length > 0) {
            for (const item of items) {
                let currentRatings = item.ktvRatings || {};
                const ktvs = item.technicianCodes || [];
                let hasChanges = false;
                for (const ktvId of ktvs) {
                    if (ktvId) {
                        currentRatings[ktvId] = rating;
                        hasChanges = true;
                    }
                }
                if (hasChanges) {
                    await supabase
                        .from('BookingItems')
                        .update({
                            itemRating: rating,
                            ktvRatings: currentRatings,
                            rating_scale: ratingScale
                        })
                        .eq('id', item.id);
                }
            }
        }

        return { success: true };
    } catch (error) {
        console.error("❌ [Server] submitGuestRating error:", error);
        return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
}


/**
 * Quầy sắp bấm Kết thúc sớm / Huỷ — KTV có bấm báo gì không?
 *
 * Hai nút cho kết quả tiền NGƯỢC NHAU, mà thứ phân biệt là KTV có báo hay
 * không. Trả về câu cảnh báo khi thao tác đi ngược với dữ liệu, để quầy còn
 * kịp dừng lại. Xem lib/ktv-notify-check.ts.
 */
export async function kiemTraTruocKhiChot(bookingId: string, thaoTac: 'FINISH_EARLY' | 'CANCEL') {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) return { success: true, canhBao: null as string | null };

        // KTV có thể đã bấm trên đơn cha hoặc đơn con — soi cả nhà.
        const { data: bk } = await supabase
            .from('Bookings').select('parent_booking_id').eq('id', bookingId).maybeSingle();
        const parentId = (bk as any)?.parent_booking_id || bookingId;
        const { data: con } = await supabase
            .from('Bookings').select('id').eq('parent_booking_id', parentId);

        const ids = Array.from(new Set([parentId, bookingId, ...(con || []).map((b: any) => b.id)]));
        const tt = await layTrangThaiBaoCuaKtv(supabase, ids);

        return { success: true, canhBao: canhBaoLechKichBan(thaoTac, tt), trangThai: tt };
    } catch (e: any) {
        // Cảnh báo hỏng thì thôi, đừng chặn thao tác của quầy.
        console.error('[kiemTraTruocKhiChot]', e?.message || e);
        return { success: true, canhBao: null as string | null };
    }
}
