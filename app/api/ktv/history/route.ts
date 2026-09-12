import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvHistoryTipSchema } from '@/lib/schemas/ktv.schema';
import { parseDbDate } from '@/lib/utils';

// 🔧 CONFIG
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * GET /api/ktv/history?techCode=NH016&dateFrom=2026-03-17&dateTo=2026-03-17
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const techCode = searchParams.get('techCode');
    const dateFrom = searchParams.get('dateFrom'); // YYYY-MM-DD (VN date)
    const dateTo = searchParams.get('dateTo');     // YYYY-MM-DD (VN date)

    if (!techCode) {
        return NextResponse.json({ success: false, error: 'techCode is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });

    try {
        const { data: allStaffData } = await supabase
            .from('Staff')
            .select('id, work_type, feature_flags');
            
        let workType = 'TYPE_A';
        const staffWorkTypeMap: Record<string, string> = {};
        const staffBonusMap: Record<string, boolean> = {};
        (allStaffData || []).forEach(s => {
            staffWorkTypeMap[s.id.toLowerCase()] = s.work_type || 'TYPE_A';
            const canBonus = s.feature_flags?.enable_bonus ?? true;
            staffBonusMap[s.id.toLowerCase()] = canBonus;
            if (s.id === techCode) {
                workType = s.work_type || 'TYPE_A';
            }
        });
        
        const commConfigs = await KtvCommissionService.getAllConfigs(supabase as any);
        const bonusConfig = await KtvCommissionService.getBonusConfig(supabase as any, workType as any);

        // ─── Build date range ────────────────────────────────────────────
        const nowVn = new Date(Date.now() + VN_OFFSET_MS);
        const todayVn = nowVn.toISOString().split('T')[0];
        const fromDate = dateFrom || todayVn;
        const toDate = dateTo || todayVn;

        // createdAt có thể là timestamp (VN local) hoặc timestamptz (UTC)
        // Dùng VN midnight trực tiếp — PostgreSQL sẽ cast chính xác cho cả 2 kiểu
        const fromFilter = `${fromDate}T00:00:00`;
        const toFilter = `${toDate}T23:59:59`;

        // ─── Fetch KTVShifts ─────────────────────────────────────────────
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('effectiveFrom, shiftType, employeeId')
            .eq('employeeId', techCode)
            .lte('effectiveFrom', toDate)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });
            
        // Áp dụng ngày lễ
        let holidayDates: any = [];
        try {
            const { data: configData } = await supabase.from('SystemConfigs').select('value').eq('key', 'holiday_shift2_dates').maybeSingle();
            if (configData?.value) {
                holidayDates = typeof configData.value === 'string' ? JSON.parse(configData.value) : configData.value;
            }
        } catch (e) {}

        const shiftMap = new Map<string, string>();
        let currentShift = 'SHIFT_1';
        
        // Tạo map cho tất cả các ngày từ fromDate tới toDate
        const startD = new Date(fromDate);
        const endD = new Date(toDate);
        
        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            
            let activeForDate = currentShift;
            for (const s of (shiftsData || [])) {
                const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                if (effDate && effDate <= dateStr) {
                    activeForDate = s.shiftType;
                }
            }
            
            const targetMonthDay = dateStr.slice(5, 10);
            let isHoliday = false;
            if (Array.isArray(holidayDates) && holidayDates.includes(targetMonthDay)) {
                isHoliday = true;
            }
            
            shiftMap.set(dateStr, isHoliday ? 'SHIFT_2' : activeForDate);
        }

        // ─── Fetch Bookings ──────────────────────────────────────────────
        const { data: rawBookings, error: bErr } = await supabase
            .from('Bookings')
            .select('id, billCode, createdAt, bookingDate, timeStart, status, rating, tip, notes, technicianCode, guestCount, BookingItems!fk_bookingitems_booking(technicianCodes)')
            .gte('bookingDate', fromFilter)
            .lte('bookingDate', toFilter)
            .in('status', ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'COMPLETED', 'DONE'])
            .order('bookingDate', { ascending: false })
            .limit(3000);

        if (bErr) throw bErr;
        
        const bookings = (rawBookings || []).filter((b: any) => {
            const hasInString = b.technicianCode?.toLowerCase().includes(techCode.toLowerCase());
            const hasInArray = b.BookingItems?.some((item: any) => 
                item.technicianCodes?.some((c: string) => c.toLowerCase() === techCode.toLowerCase())
            );
            return hasInString || hasInArray;
        });

        if (!bookings || bookings.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // ─── Fetch BookingItems for these bookings ────────────────────────
        const bookingIds = bookings.map((b: any) => b.id);
        console.log('🔍 [DEBUG] bookingIds:', JSON.stringify(bookingIds));
        const { data: items, error: iErr } = await supabase
            .from('BookingItems')
            .select('id, bookingId, serviceId, technicianCodes, tip, segments, itemRating, ktvRatings, options, handover_status, handover_comment, status')
            .in('bookingId', bookingIds);
        console.log('🔍 [DEBUG] BookingItems error:', iErr, 'count:', items?.length);

        // ─── Fetch Service names ─────────────────────────────────────────
        const allServiceIds = [...new Set((items || []).map((i: any) => i.serviceId).filter(Boolean))];

        let svcMap: Record<string, string> = {};
        let svcDurationMap: Record<string, number> = {};
        let svcUtilityMap: Record<string, boolean> = {};
        if (allServiceIds.length > 0) {
            // Try id lookup first
            const { data: svcsById } = await supabase
                .from('Services')
                .select('id, code, nameVN, duration, is_utility')
                .in('id', allServiceIds);
            (svcsById || []).forEach((s: any) => {
                if (s.id)   svcMap[String(s.id)]   = s.nameVN || s.code || String(s.id);
                if (s.code) svcMap[String(s.code)]  = s.nameVN || s.code || String(s.id);
                if (s.id)   svcDurationMap[String(s.id)]   = Number(s.duration) || 0;
                if (s.id)   svcUtilityMap[String(s.id)] = !!s.is_utility;
                if (s.code) svcDurationMap[String(s.code)]  = Number(s.duration) || 0;
                if (s.code) svcUtilityMap[String(s.code)] = !!s.is_utility;
            });

            // Fallback: serviceId may be a code string — query by code for unresolved ones
            const unresolved = allServiceIds.filter(sid => !svcMap[String(sid)]);
            if (unresolved.length > 0) {
                const { data: svcsByCode } = await supabase
                    .from('Services')
                    .select('id, code, nameVN, duration, is_utility')
                    .in('code', unresolved);
                (svcsByCode || []).forEach((s: any) => {
                    if (s.id)   svcMap[String(s.id)]   = s.nameVN || s.code || String(s.id);
                    if (s.code) svcMap[String(s.code)]  = s.nameVN || s.code || String(s.id);
                    if (s.id)   svcDurationMap[String(s.id)]   = Number(s.duration) || 0;
                if (s.id)   svcUtilityMap[String(s.id)] = !!s.is_utility;
                    if (s.code) svcDurationMap[String(s.code)]  = Number(s.duration) || 0;
                if (s.code) svcUtilityMap[String(s.code)] = !!s.is_utility;
                });
            }
        }


        // ─── Build result ─────────────────────────────────────────────────
        console.log('🔍 [DEBUG] BookingItems raw:', JSON.stringify((items || []).map((i: any) => ({
            id: i.id, bookingId: i.bookingId, technicianCodes: i.technicianCodes, tip: i.tip
        }))));

        const result = bookings.flatMap((b: any) => {
            const allItems = (items || []).filter((i: any) => i.bookingId === b.id);
            
            // Re-construct booking with nested items to use service methods
            const fullBooking = { ...b, BookingItems: allItems };

            // Filter items belonging to this KTV in this booking
            const myItems = allItems.filter((i: any) =>
                i.technicianCodes &&
                Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
            );
            
            const relevantItemsOriginal = myItems.length > 0 ? myItems : allItems;
            let relevantItems = relevantItemsOriginal.filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
            
            // Nếu lọc xong mà rỗng (vd: chỉ làm mỗi tiện ích? Thường ko có), ta giữ lại để tránh lỗi
            if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
                relevantItems = relevantItemsOriginal;
            }

            console.log(`🔍 [DEBUG] Booking ${b.billCode}: myItems=${myItems.length}, relevant=${relevantItems.length}, tips=${relevantItems.map((i: any) => i.tip)}`);

            // 🔥 TÁCH GROUP TỪ ALL_ITEMS ĐỂ LẤY SUFFIX ĐÚNG
            const allItemGroups = new Map<string, any[]>();
            const nonUtilityAllItems = allItems.filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
            const itemsToGroup = nonUtilityAllItems.length > 0 ? nonUtilityAllItems : allItems;
            
            for (const item of itemsToGroup) {
                const opts = typeof item.options === 'string' ? JSON.parse(item.options) : (item.options || {});
                const groupId = opts.mergedIntoId || item.id;
                if (!allItemGroups.has(groupId)) allItemGroups.set(groupId, []);
                allItemGroups.get(groupId)!.push(item);
            }

            // Map groupId -> Suffix (A, B, C)
            const groupIdList = Array.from(allItemGroups.keys());
            const suffixMap = new Map<string, string>();
            groupIdList.forEach((groupId, idx) => {
                suffixMap.set(groupId, allItemGroups.size > 1 ? `-${String.fromCharCode(65 + idx)}` : '');
            });

            // Group cho KTV hiện tại (chỉ lấy các item KTV có làm)
            const itemGroups = new Map<string, any[]>();
            for (const item of relevantItems) {
                const opts = typeof item.options === 'string' ? JSON.parse(item.options) : (item.options || {});
                const groupId = opts.mergedIntoId || item.id;
                if (!itemGroups.has(groupId)) itemGroups.set(groupId, []);
                itemGroups.get(groupId)!.push(item);
            }

            // Mỗi group sẽ tạo ra 1 dòng lịch sử riêng rẽ
            const groupsArray = Array.from(itemGroups.values());
            return groupsArray.map((groupItems: any[]) => {
                let totalDuration = 0;
                let commission = 0;
                let passedCount = 0;
                for (const item of groupItems) {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = 60;
                    totalDuration += itemDuration;
                    
                    const { isPassed } = KtvCommissionService.checkIsItemPassed(item, b, techCode);
                    if (isPassed) {
                        passedCount++;
                        commission += KtvCommissionService.calcCommission(itemDuration, commConfigs, workType, item.serviceId);
                    }
                }
                if (commission === 0 && passedCount > 0) commission = KtvCommissionService.calcCommission(60, commConfigs, workType, '');

                const serviceNames = groupItems
                    .map((i: any) => (i.options && i.options.displayName) ? i.options.displayName : (svcMap[String(i.serviceId)] || String(i.serviceId || '').toUpperCase()))
                    .filter(Boolean);
                const serviceName = serviceNames.length > 1
                    ? serviceNames.join(' + ')
                    : (serviceNames[0] || '—');

                // ─── Rating: lấy từ BookingItems!fk_bookingitems_booking (item-level) ────
                const itemRating = groupItems.reduce((best: number, i: any) => {
                    const r = Number(i.itemRating) || 0;
                    return r > best ? r : best;
                }, 0) || null;

                // ─── Bonus points ─────────────
                const dbDate = parseDbDate(b.bookingDate || b.createdAt);
                const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
                const bDateStr = formatter.format(dbDate);
                const shiftType = shiftMap.get(bDateStr) || 'SHIFT_1';
                
                const dynamicShiftsData = [{
                    employeeId: techCode,
                    shiftType: shiftType,
                    effectiveFrom: bDateStr
                }];
                
                let bonusPoints = 0;
                if (passedCount > 0) {
                    const bDate = new Date(b.timeStart || (b as any).createdAt || bDateStr);
                    const isNewRule = bDate >= new Date('2026-08-05T00:00:00+07:00');
                    // TÍNH BONUS CHO TỪNG ĐƠN CON (GROUP)
                    const bForBonus = fullBooking;
                    const targetGuestId = groupItems[0]?.guest_id;
                    bonusPoints = KtvCommissionService.calculateBookingBonus(bForBonus, techCode, bDateStr, dynamicShiftsData, bonusConfig, staffWorkTypeMap, staffBonusMap, isNewRule, targetGuestId);
                }

                // ─── Tip: sum from this group's items ────────────────────────
                const ktvTip = groupItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);

                // ─── Lấy handover status ──────────────────────────────
                const handoverItem = groupItems.find((i: any) => i.handover_status) || groupItems[0];
                const handover_status = handoverItem?.handover_status || 'PENDING';
                const handover_comment = handoverItem?.handover_comment || null;

                // Tìm KTV làm cùng trong CÙNG booking này (đơn con)
                const allKTVsInBooking = new Set<string>();
                groupItems.forEach((i: any) => {
                    if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                        i.technicianCodes.forEach((tc: string) => {
                            if (tc && tc.trim()) allKTVsInBooking.add(tc.trim().toUpperCase());
                        });
                    }
                });
                const coWorkers = Array.from(allKTVsInBooking).filter(tc => tc.toLowerCase() !== techCode.toLowerCase());

                // 🧠 STATUS: Xét theo BookingItems của group này
                const myItemStatuses = groupItems.map((i: any) => i.status || 'NEW');
                const { recomputeBookingStatus } = require('@/lib/dispatch-status');
                const itemBasedStatus = myItemStatuses.length > 0
                    ? recomputeBookingStatus(myItemStatuses)
                    : b.status;

                const opts0 = typeof groupItems[0].options === 'string' ? JSON.parse(groupItems[0].options) : (groupItems[0].options || {});
                const groupId0 = opts0.mergedIntoId || groupItems[0].id;
                const billSuffix = suffixMap.get(groupId0) || '';

                return {
                    id: `${b.id}_${groupItems[0].id}`, // Đảm bảo ID duy nhất cho mỗi dòng lịch sử (BookingID + ItemID)
                    billCode: `${b.billCode}${billSuffix}`,
                    createdAt: b.createdAt,
                    bookingDate: b.bookingDate,
                    status: itemBasedStatus,
                    rating: itemRating,
                    tip: ktvTip,
                    commission,
                    serviceName,
                    duration: totalDuration,
                    bonusPoints,
                    handover_status,
                    handover_comment,
                    ktv_comment: b.notes,
                    guestCount: allItemGroups.size > 1 ? 1 : (b.guestCount || 1),
                    coWorkers,
                    isHeld: passedCount === 0
                };
            });
        });

        // ─── Fetch KTV Discipline Data ─────────────────────────────────────
        const currentMonth = new Date(fromDate).getMonth() + 1;
        const currentYear = new Date(fromDate).getFullYear();

        const { data: ptsData } = await supabase
            .from('KTVDisciplinePoints')
            .select('total_points')
            .eq('staff_id', techCode)
            .eq('month', currentMonth)
            .eq('year', currentYear)
            .maybeSingle();
            
        const { data: discData } = await supabase
            .from('KTVDisciplineLedger')
            .select('id, rule_code, points_deducted, reason, images, status, created_at, booking_id')
            .eq('staff_id', techCode)
            .gte('created_at', fromFilter)
            .lte('created_at', toFilter)
            .order('created_at', { ascending: false });

        return NextResponse.json({ 
            success: true, 
            data: {
                bookings: result,
                disciplinePoints: ptsData?.total_points ?? 100,
                disciplines: discData || []
            } 
        });

    } catch (err: any) {
        console.error('❌ [KTV History API]', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

/**
 * POST /api/ktv/history
 * KTV nhập tiền tip cho dịch vụ riêng của mình (BookingItems)
 * Body: { action: 'update_tip', bookingId, techCode, tip }
 */
export async function POST(request: Request) {
    const body = await request.json();
    const parseResult = KtvHistoryTipSchema.safeParse(body);
    if (!parseResult.success) {
        return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
    }
    const { bookingId, techCode, tip } = parseResult.data;

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });

    // Find the BookingItem assigned to this KTV in this booking
    const { data: items } = await supabase
        .from('BookingItems')
        .select('id, technicianCodes')
        .eq('bookingId', bookingId);

    const myItem = (items || []).find((i: any) =>
        i.technicianCodes &&
        Array.isArray(i.technicianCodes) &&
        i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
    );

    const targetItem = myItem || items?.[0];
    if (!targetItem) {
        return NextResponse.json({ success: false, error: 'No BookingItem found' }, { status: 404 });
    }

    const { error } = await supabase
        .from('BookingItems')
        .update({ tip: Number(tip) })
        .eq('id', targetItem.id);

    if (error) {
        console.error('❌ [Tip PATCH]', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, itemId: targetItem.id });
}
