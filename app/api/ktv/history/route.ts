import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvTypeDCommissionService } from '@/lib/services/KtvTypeDCommissionService';
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
    const datesStr = searchParams.get('dates');    // "2026-09-01,2026-09-02,..."

    if (!techCode) {
        return NextResponse.json({ success: false, error: 'techCode is required' }, { status: 400 });
    }

    let minDate = dateFrom;
    let maxDate = dateTo;
    let targetDates: string[] | null = null;

    if (datesStr) {
        targetDates = datesStr.split(',').filter(Boolean);
        if (targetDates.length > 0) {
            targetDates.sort();
            minDate = targetDates[0];
            maxDate = targetDates[targetDates.length - 1];
        }
    }

    if (!minDate || !maxDate) {
        return NextResponse.json({ success: false, error: 'Missing date range or dates' }, { status: 400 });
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

        // ─── Cấu hình quy đổi điểm & thuế TNCN ────────────────────────────
        // bonusPoints là ĐIỂM; nhân pointRate mới ra VNĐ để tính thuế.
        // ⚠️ SystemConfigs.value là jsonb → có thể về dạng số, chuỗi, hoặc chuỗi có nháy.
        const { data: taxCfgRows } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', [`ktv_bonus_rate_${workType}`, 'ktv_bonus_rate', 'ktv_type_d_tax_effective_from']);

        const cfgMap: Record<string, any> = {};
        (taxCfgRows || []).forEach((c: any) => { cfgMap[c.key] = c.value; });
        const readNum = (v: any, dflt: number) => {
            const n = Number(String(v ?? '').replace(/"/g, '').trim());
            return Number.isFinite(n) && n > 0 ? n : dflt;
        };

        const pointRate = readNum(cfgMap[`ktv_bonus_rate_${workType}`] ?? cfgMap['ktv_bonus_rate'], 1000);

        // Cấu hình riêng của Loại D: đơn giá VIP/PT và tỉ lệ trừ theo sao.
        let rateVIP_D = 180000, ratePT_D = 100000;
        let ratingDeductions_D: Record<string, number> = { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 };
        if (workType === 'TYPE_D') {
            const { data: dRows } = await supabase
                .from('SystemConfigs')
                .select('key, value')
                .in('key', ['ktv_type_d_vip_rate_per_60m', 'ktv_type_d_pt_rate_per_60m', 'ktv_type_d_rating_deduction']);
            const dMap: Record<string, any> = {};
            (dRows || []).forEach((c: any) => { dMap[c.key] = c.value; });
            rateVIP_D = readNum(dMap['ktv_type_d_vip_rate_per_60m'], 180000);
            ratePT_D = readNum(dMap['ktv_type_d_pt_rate_per_60m'], 100000);
            const rawDeduction = dMap['ktv_type_d_rating_deduction'];
            if (rawDeduction) {
                try {
                    ratingDeductions_D = typeof rawDeduction === 'string' ? JSON.parse(rawDeduction) : rawDeduction;
                } catch { /* giữ mặc định */ }
            }
        }
        const taxEffectiveFrom = String(cfgMap['ktv_type_d_tax_effective_from'] ?? '').replace(/"/g, '').trim();
        // Thuế 10% hiện chỉ áp cho KTV Loại D, từ ngày đã cấu hình trở đi.
        const TAX_RATE = 0.1;
        const isTaxableWorkType = workType === 'TYPE_D' && !!taxEffectiveFrom;

        // ─── Build date range ────────────────────────────────────────────
        const nowVn = new Date(Date.now() + VN_OFFSET_MS);
        // Dùng VN midnight trực tiếp — PostgreSQL sẽ cast chính xác cho cả 2 kiểu
        const fromFilter = `${minDate}T00:00:00`;
        const toFilter = `${maxDate}T23:59:59`;

        // ─── Fetch KTVShifts ─────────────────────────────────────────────
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('effectiveFrom, shiftType, employeeId')
            .eq('employeeId', techCode)
            .lte('effectiveFrom', toFilter)
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
        
        // Tạo map cho tất cả các ngày từ minDate tới maxDate
        const startD = new Date(minDate);
        const endD = new Date(maxDate);
        
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
            // 'CANCELLED' phải có trong danh sách: thiếu nó thì đơn quầy đã huỷ
            // BIẾN MẤT khỏi lịch sử KTV — người đã vào làm rồi mà tra lại không thấy
            // đâu, không biết đơn đi đâu về đâu.
            .in('status', ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'COMPLETED', 'DONE', 'CANCELLED'])
            .order('bookingDate', { ascending: false })
            .limit(3000);

        if (bErr) throw bErr;
        
        const bookings = (rawBookings || []).filter((b: any) => {
            const hasInString = b.technicianCode?.toLowerCase().includes(techCode.toLowerCase());
            const hasInArray = b.BookingItems?.some((item: any) => 
                item.technicianCodes?.some((c: string) => c.toLowerCase() === techCode.toLowerCase())
            );
            
            if (targetDates && targetDates.length > 0) {
                // Đảm bảo lấy đúng ngày theo múi giờ VN (nếu createdAt đang là UTC)
                const vnDate = new Date(new Date(b.createdAt).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
                const bDate = b.bookingDate ? String(b.bookingDate).slice(0, 10) : vnDate;
                if (!targetDates.includes(bDate)) {
                    return false;
                }
            }
            
            return hasInString || hasInArray;
        });
        
        console.log(`[DEBUG History] targetDates: ${targetDates}, bookings length: ${bookings.length}`);

        if (!bookings || bookings.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // ─── Fetch BookingItems for these bookings ────────────────────────
        const bookingIds = bookings.map((b: any) => b.id);

        // ─── Loại D: lấy số từ SỔ CÁI, không tính lại ─────────────────────
        // Tiền, giờ, sao và thuế đều đọc từ KTVDTurnLedger. Trước đây chỗ này
        // tự tính lại nên lệch với ví (sao cấp bill thay vì cấp khách, thuế
        // làm tròn từng đơn). Xem plans/plan_ktvd_turn_ledger.md.
        const ledgerByGroup = new Map<string, any>();
        if (workType === 'TYPE_D' && bookingIds.length > 0) {
            const { drainQueueFor } = await import('@/lib/services/KtvDLedgerWriter');
            const { getRows, groupForHistory } = await import('@/lib/services/KtvDLedgerReader');

            // Tua vừa xong có thể còn nằm trong hàng đợi (worker chạy 5 phút/lần).
            // Tính ngay những item thuộc đúng các đơn đang xem — bó hẹp, không
            // quét cả hàng đợi — để KTV thấy tua vừa làm mà không phải chờ.
            try { await drainQueueFor(supabase as any, bookingIds); } catch { /* không chặn hiển thị */ }

            const rows = await getRows(supabase as any, { staffIds: [techCode], from: minDate, to: maxDate });
            for (const g of groupForHistory(rows)) {
                ledgerByGroup.set(`${g.booking_id}|${g.rows[0].group_id}`, g);
            }
        }
        console.log('🔍 [DEBUG] bookingIds:', JSON.stringify(bookingIds));
        const { data: items, error: iErr } = await supabase
            .from('BookingItems')
            .select('id, bookingId, guest_id, serviceId, technicianCodes, tip, segments, itemRating, ktvRatings, options, handover_status, handover_comment, handover_submitted_at, status, violations')
            .in('bookingId', bookingIds);
        console.log('🔍 [DEBUG] BookingItems error:', iErr, 'count:', items?.length);

        // ─── Khách của từng dòng ─────────────────────────────────────────
        // Một bill tách nhiều khách thì mã đơn của các dòng chỉ khác nhau đúng
        // chữ cái cuối (-A, -B, -C). Kèm tên/nhãn khách vào cho dễ nhận ra dòng
        // nào là dòng nào — nhất là lúc đi soi lỗi.
        const guestIds = [...new Set((items || []).map((i: any) => i.guest_id).filter(Boolean))];
        const guestMap: Record<string, string> = {};
        if (guestIds.length > 0) {
            const { data: guestRows } = await supabase
                .from('BookingGuests')
                .select('id, guest_index, guest_label, customer_name')
                .in('id', guestIds);
            for (const g of guestRows || []) {
                guestMap[String(g.id)] = String(
                    g.customer_name || g.guest_label || (g.guest_index ? `Khách ${g.guest_index}` : '')
                ).trim();
            }
        }

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
                const opts0 = typeof groupItems[0].options === 'string' ? JSON.parse(groupItems[0].options) : (groupItems[0].options || {});
                const groupId0 = opts0.mergedIntoId || groupItems[0].id;

                let totalDuration = 0;
                let actualDuration = 0;
                let commission = 0;
                let passedCount = 0;
                for (const item of groupItems) {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = 60;
                    totalDuration += itemDuration;

                    // Calculate actual working time from segments
                    let segs: any[] = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
                    const mySegs = segs.filter((s: any) => s.ktvId && s.ktvId.toLowerCase() === techCode.toLowerCase());
                    for (const seg of mySegs) {
                        if (seg.actualStartTime && seg.actualEndTime) {
                            const t1 = new Date(seg.actualStartTime).getTime();
                            const t2 = new Date(seg.actualEndTime).getTime();
                            if (!isNaN(t1) && !isNaN(t2) && t2 > t1) {
                                actualDuration += Math.round((t2 - t1) / 60000);
                            }
                        }
                    }
                    
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

                // ─── Loại D: ĐỌC từ sổ cái, không tính lại ─────────────────────────
                // Số ở đây phải khớp tuyệt đối với ví, nên cả hai cùng đọc
                // KTVDTurnLedger. Trước đây chỗ này tự tính nên lệch với ví ở hai
                // điểm: sao lấy cấp bill (`itemRating`) thay vì cấp khách, và thuế
                // làm tròn từng đơn trong khi ví làm tròn trên tổng ngày.
                //
                // Sổ cái lưu KHÔNG làm tròn; làm tròn ở đây — tầng hiển thị.
                let commissionBeforeDeduction = commission;
                let ratingDeductionRate = 0;
                let ledgerRating: number | null = null;
                let ledgerTax: number | null = null;
                let ledgerActualDuration: number | null = null;
                let mixedTeamNote: string | null = null;

                if (workType === 'TYPE_D') {
                    const led = ledgerByGroup.get(`${b.id}|${groupId0}`);
                    if (led) {
                        commission = Math.round(led.commission_net);
                        commissionBeforeDeduction = Math.round(led.commission_gross);
                        ratingDeductionRate = led.deduction_rate;
                        ledgerRating = led.rating;
                        ledgerTax = Math.round(led.tax_amount);
                        ledgerActualDuration = Math.round(led.actual_minutes);
                        totalDuration = Math.round(led.assigned_minutes) || totalDuration;
                        // Giải thích vì sao tua này không có thưởng dù được chấm cao.
                        if (led.rows.some((r: any) => r.has_other_type_coworker)) {
                            mixedTeamNote = 'Làm cùng KTV khác chế độ — tua này không có thưởng';
                        }
                    } else {
                        // Chưa có dòng trong sổ = tua chưa đủ điều kiện tính tiền
                        // (chưa có segment, hoặc chưa tới trạng thái được tính).
                        // Hiện 0 chứ KHÔNG tính lại — tính lại là đẻ lại đúng cái
                        // lệch mà kiến trúc này sinh ra để xoá.
                        commission = 0;
                        commissionBeforeDeduction = 0;
                    }
                }

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
                // 'PENDING' là GIÁ TRỊ MẶC ĐỊNH của cột, mọi item chưa từng bàn giao
                // đều mang nó. Chỉ có mốc nộp ảnh mới phân biệt được "đã nộp, đang
                // chờ quầy" với "chưa nộp gì cả".
                const handover_submitted = !!groupItems.find((i: any) => i.handover_submitted_at);

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
                let itemBasedStatus = myItemStatuses.length > 0
                    ? recomputeBookingStatus(myItemStatuses)
                    : b.status;

                // ─── Hai chỗ recomputeBookingStatus() không diễn tả được ───────
                const optsOf = (i: any) => {
                    try { return typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {}); }
                    catch { return {}; }
                };

                // 1. ĐÃ HUỶ. Hai lớp:
                //
                //    a) recomputeBookingStatus() gộp CANCELLED chung với DONE ở nhánh
                //       cuối nên trả 'DONE' — hiện "Hoàn tất" cho một đơn đã huỷ.
                //       KHÔNG sửa hàm đó vì bảng điều phối dựa vào nó để xếp cột.
                //
                //    b) Cột `status` có thể ĐÃ BỊ GHI ĐÈ mất dấu huỷ: trước đây KTV
                //       dọn nốt phòng rồi bấm bàn giao là item bị lật về FEEDBACK.
                //       (Đã bịt ở handleFinishService, nhưng dữ liệu cũ vẫn sai.)
                //       `options.cancelCredit` do chính đường huỷ ghi và không đường
                //       nào xoá, nên nó là dấu vết bền hơn cột status.
                const daHuy = (i: any) => {
                    if (String(i.status).toUpperCase() === 'CANCELLED') return true;
                    const o = optsOf(i);
                    return o?.cancelCredit !== undefined || !!o?.cancelReason;
                };
                const allCancelled = groupItems.length > 0 && groupItems.every(daHuy);

                // 2. QUẦY BẤM KẾT THÚC SỚM (`options.earlyLeave`). Khách đã về nên
                //    không còn ai chấm sao — Kanban bỏ qua bước Chờ đánh giá từ lâu,
                //    lịch sử KTV thì chưa, nên đơn nằm mãi ở "Chờ đánh giá" và tiền
                //    mãi là "tạm tính".
                const isEarlyLeave = groupItems.some((i: any) => optsOf(i)?.earlyLeave === true);

                if (allCancelled) itemBasedStatus = 'CANCELLED';
                else if (isEarlyLeave && itemBasedStatus === 'FEEDBACK') itemBasedStatus = 'DONE';

                const billSuffix = suffixMap.get(groupId0) || '';
                const guestLabel = guestMap[String(groupItems[0]?.guest_id || '')] || null;

                // ─── Tạm tính hay đã chốt? ──────────────────────────────────────
                // Đơn chưa được khách FB thì KHÔNG hiện tiền.
                // Chỉ khi status = DONE/COMPLETED (khách đã FB hoặc bị bỏ qua) mới hiện số tiền thực nhận.
                const hasRating = itemRating != null && Number(itemRating) > 0;
                // 'CANCELLED' cũng là chốt: đơn huỷ sẽ KHÔNG BAO GIỜ có rating, để nó
                // ở "tạm tính" là treo vĩnh viễn.
                const isFinalStatus = ['DONE', 'COMPLETED', 'CANCELLED'].includes(itemBasedStatus);
                const isFeedbackDone = isFinalStatus; // Khách đã FB hoặc đã bỏ qua
                const isProvisional = !hasRating && !isFinalStatus;

                // ─── Quy đổi bonus ra tiền + thuế TNCN ─────────────────────────
                const bonusValue = Math.round(bonusPoints * pointRate);
                const grossIncome = commission + bonusValue;
                const isTaxed = isTaxableWorkType && String(b.bookingDate || bDateStr) >= taxEffectiveFrom;

                // Loại D: thuế phần hoa hồng lấy thẳng từ sổ cái (không làm tròn khi
                // lưu, làm tròn ở đây) để khớp tuyệt đối với ví. Thuế phần thưởng vẫn
                // tính ở đây vì thưởng tính theo KHÁCH, không thuộc tầng đơn.
                const taxAmount = workType === 'TYPE_D'
                    ? (ledgerTax ?? 0) + (isTaxed ? Math.round(bonusValue * TAX_RATE) : 0)
                    : (isTaxed ? Math.round(grossIncome * TAX_RATE) : 0);

                return {
                    id: `${b.id}_${groupItems[0].id}`, // Đảm bảo ID duy nhất cho mỗi dòng lịch sử (BookingID + ItemID)
                    billCode: `${b.billCode}${billSuffix}`,
                    guestLabel,
                    createdAt: b.createdAt,
                    bookingDate: b.bookingDate,
                    status: itemBasedStatus,
                    rating: workType === 'TYPE_D' ? (ledgerRating ?? itemRating) : itemRating,
                    tip: isFeedbackDone ? ktvTip : 0,
                    commission: isFeedbackDone ? commission : null,
                    serviceName,
                    duration: totalDuration,
                    actualDuration: workType === 'TYPE_D'
                        ? (ledgerActualDuration ?? null)
                        : (actualDuration > 0 ? actualDuration : null),
                    bonusPoints: isFeedbackDone ? bonusPoints : 0,
                    bonusValue: isFeedbackDone ? bonusValue : 0,
                    grossIncome: isFeedbackDone ? grossIncome : null,
                    taxRate: isTaxed ? TAX_RATE : 0,
                    taxAmount: isFeedbackDone ? taxAmount : 0,
                    netIncome: isFeedbackDone ? (grossIncome - taxAmount) : null,
                    isProvisional,
                    isFeedbackDone,      // true = khách đã FB hoặc bỏ qua, số tiền đã chốt
                    isTypeD: workType === 'TYPE_D',
                    commissionBeforeDeduction: isFeedbackDone ? commissionBeforeDeduction : null,
                    ratingDeductionRate: isFeedbackDone ? ratingDeductionRate : 0,
                    ratingDeductionAmount: isFeedbackDone ? Math.max(0, commissionBeforeDeduction - commission) : 0,
                    mixedTeamNote,
                    handover_status,
                    handover_submitted,
                    handover_comment,
                    // Ô góp ý khách đã tích. Tích lỗi kéo trần đánh giá xuống 3 sao
                    // nên KTV phải xem được mình bị phản ánh chuyện gì, khỏi thắc mắc.
                    violations: (() => {
                        const merged = new Map<string, any>();
                        for (const i of groupItems) {
                            for (const v of (Array.isArray(i.violations) ? i.violations : [])) {
                                if (v && v.id) merged.set(String(v.id), v);
                            }
                        }
                        return Array.from(merged.values());
                    })(),
                    ktv_comment: b.notes,
                    guestCount: allItemGroups.size > 1 ? 1 : (b.guestCount || 1),
                    coWorkers,
                    isHeld: passedCount === 0
                };
            });
        });

        // ─── Fetch KTV Discipline Data ─────────────────────────────────────
        const currentMonth = new Date(minDate).getMonth() + 1;
        const currentYear = new Date(minDate).getFullYear();

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

        let finalDiscData = discData || [];
        if (targetDates && targetDates.length > 0) {
            finalDiscData = finalDiscData.filter((d: any) => {
                const vnDate = new Date(new Date(d.created_at).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
                return targetDates.includes(vnDate);
            });
        }

        return NextResponse.json({ 
            success: true, 
            data: {
                bookings: result,
                disciplinePoints: ptsData?.total_points ?? 100,
                disciplines: finalDiscData
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
