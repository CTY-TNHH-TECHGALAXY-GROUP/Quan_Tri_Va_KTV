import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvTypeDCommissionService } from '@/lib/services/KtvTypeDCommissionService';
import { KtvHistoryTipSchema } from '@/lib/schemas/ktv.schema';
import { parseDbDate } from '@/lib/utils';
import { coWorkersOfItems } from '@/lib/co-workers';
import { resolveStaffFlag } from '@/lib/featureFlags';
import { featureMaintenanceBody } from '@/lib/featureMaintenance';
import { getDayCutoffHours, toBusinessDate, shiftBusinessDate } from '@/lib/business-date';

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

        // History page switched off for this KTV → the maintenance answer, not
        // data. The server decides (the client's flags are a login-time
        // snapshot), so turning it back on works on the very next request.
        const target = (allStaffData || []).find(s => String(s.id).toLowerCase() === techCode.toLowerCase());
        if (target && !resolveStaffFlag(target.feature_flags, 'history_page')) {
            return NextResponse.json(featureMaintenanceBody(), { status: 403 });
        }

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

        /**
         * NGÀY LÀM VIỆC của spa (chốt lúc `cutoff`, mặc định 6h sáng) — cùng
         * trục ngày mà Ví và sổ cái đang dùng.
         *
         * ⚠️ `Bookings.bookingDate` KHÔNG dùng làm trục ngày được: cùng một cột
         * mà ba đường ghi ba kiểu — có đơn lưu giờ UTC (`005-02092026`), có đơn
         * lưu giờ VN (`TEST-260902-JRYL`), đơn web thì lưu giờ HẸN của khách
         * (`WB-001-02092026` → 03/09 03:30 dù tạo tối 02/09). Nay nó chỉ còn
         * dùng để QUÉT RỘNG, còn ngày thật do sổ cái / mốc giờ thật quyết.
         */
        const cutoffHours = await getDayCutoffHours(supabase);
        const queryFrom = shiftBusinessDate(minDate, -1);
        const queryTo = shiftBusinessDate(maxDate, 1);
        const bookingFromFilter = `${queryFrom}T00:00:00`;
        const bookingToFilter = `${queryTo}T23:59:59`;

        /** Dòng này thuộc ngày làm việc nào — sổ cái nói trước, không có thì suy từ mốc giờ thật. */
        const businessDateOf = (ledgerWorkDate: string | null, b: any): string =>
            ledgerWorkDate
                ? String(ledgerWorkDate).slice(0, 10)
                : toBusinessDate(parseDbDate(b.timeStart || b.createdAt), cutoffHours);

        /** Ngày làm việc này có nằm trong khoảng KTV đang chọn không. */
        const isPickedDay = (bd: string): boolean =>
            (targetDates && targetDates.length > 0)
                ? targetDates.includes(bd)
                : (bd >= minDate && bd <= maxDate);

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
        // Phủ trọn cửa sổ quét (±1 ngày): đơn kéo vào từ ngày sát biên cũng phải
        // tra được ca của nó, thiếu thì rơi về SHIFT_1 và tính sai thưởng A/B/C.
        const startD = new Date(queryFrom);
        const endD = new Date(queryTo);
        
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
            .gte('bookingDate', bookingFromFilter)
            .lte('bookingDate', bookingToFilter)
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
            
            // KHÔNG lọc ngày ở đây nữa. Một bill tách nhiều khách có thể rơi vào
            // HAI ngày làm việc khác nhau (`WB-001-02092026`: khách A ngày 02/09,
            // khách B ngày 03/09), nên ngày phải quyết ở CẤP DÒNG, sau khi đã biết
            // sổ cái nói gì. Lọc ở cuối hàm bằng `isPickedDay`.
            
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

            // Cửa sổ rộng bằng đúng cửa sổ đơn: đơn bị kéo vào từ ngày sát biên
            // vẫn phải tra được dòng sổ cái của nó, nếu không lại ra 0đ.
            const rows = await getRows(supabase as any, { staffIds: [techCode], from: queryFrom, to: queryTo });
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

        const rawResult = bookings.flatMap((b: any) => {
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
                // Dịch vụ mà KTV đã bị TƯỚC quyền lợi (đổi ra, huỷ không công).
                // Xem KtvCommissionService.isKtvVoidedOnItem để hiểu vì sao không
                // được dựa vào `itemDuration <= 0` để nhận ra chuyện này.
                const coItemConQuyenLoi = groupItems.some(
                    (i: any) => !KtvCommissionService.isKtvVoidedOnItem(i, techCode)
                );

                // Nhãn giải thích cho KTV khi họ bị tước sạch quyền lợi ở đơn này.
                // Plan Đợt 4 #10: lịch sử KTV vẫn phải thấy "từng làm cho khách",
                // kèm nhãn và số phút đã làm, dù tiền = 0. Không có nhãn thì đơn
                // hiện ra y như đơn thường mà tiền lại bằng 0 — không giải thích được.
                // Nhãn + LÝ DO, thay cho dòng "đã làm Xp" trước đây.
                // KTV bị đổi cần biết VÌ SAO tua đó 0đ, chứ số phút họ tự biết. Lý do
                // đổi người lưu ở chặng bị tước (`lyDoDoi`, quầy nhập lúc đổi); lý do
                // huỷ lưu ở `options.cancelReason` của dịch vụ.
                // Loại tước + lý do, trả CÓ CẤU TRÚC để màn hình tự dựng câu và biết
                // phải ẩn những dòng nào (tiền chờ FB, đánh giá, bàn giao…).
                const voidedInfo: { kind: 'CHANGED' | 'CANCELLED_NO_CREDIT' | 'OTHER'; reason: string | null } | null = (() => {
                    if (groupItems.length === 0 || coItemConQuyenLoi) return null;
                    let loai = '';
                    let lyDo = '';
                    for (const i of groupItems) {
                        let segs: any[] = [];
                        try { segs = typeof i.segments === 'string' ? JSON.parse(i.segments) : (i.segments || []); } catch { }
                        for (const s of (Array.isArray(segs) ? segs : [])) {
                            if (s?.voided !== true) continue;
                            if (!s.ktvId || !String(s.ktvId).toLowerCase().includes(techCode.toLowerCase())) continue;
                            if (!loai) loai = String(s.note || '');
                            if (!lyDo && s.lyDoDoi) lyDo = String(s.lyDoDoi);
                        }
                        if (!lyDo) {
                            try {
                                const o = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
                                if (o?.cancelReason) lyDo = String(o.cancelReason);
                            } catch { }
                        }
                    }
                    const kind = loai === 'CHANGED' ? 'CHANGED'
                        : loai === 'CANCELLED_NO_CREDIT' ? 'CANCELLED_NO_CREDIT'
                        : 'OTHER';
                    return { kind, reason: lyDo.trim() || null };
                })();

                const voidedNote: string | null = (() => {
                    if (groupItems.length === 0 || coItemConQuyenLoi) return null;
                    let loai = '';
                    let lyDo = '';
                    for (const i of groupItems) {
                        let segs: any[] = [];
                        try { segs = typeof i.segments === 'string' ? JSON.parse(i.segments) : (i.segments || []); } catch { }
                        for (const s of (Array.isArray(segs) ? segs : [])) {
                            if (s?.voided !== true) continue;
                            if (!s.ktvId || !String(s.ktvId).toLowerCase().includes(techCode.toLowerCase())) continue;
                            if (!loai) loai = String(s.note || '');
                            if (!lyDo && s.lyDoDoi) lyDo = String(s.lyDoDoi);
                        }
                        if (!lyDo) {
                            try {
                                const o = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
                                if (o?.cancelReason) lyDo = String(o.cancelReason);
                            } catch { }
                        }
                    }
                    const nhan = loai === 'CHANGED' ? 'Đã đổi KTV'
                        : loai === 'CANCELLED_NO_CREDIT' ? 'Huỷ không tính công'
                        : 'Không tính công';
                    return lyDo ? `${nhan} — ${lyDo}` : `${nhan} · 0đ`;
                })();

                for (const item of groupItems) {
                    const biTuoc = KtvCommissionService.isKtvVoidedOnItem(item, techCode);
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    // Dự phòng 60 phút chỉ dành cho đơn THIẾU DỮ LIỆU, không dành cho
                    // đơn bị tước — bị tước là đúng 0.
                    if (itemDuration <= 0) itemDuration = biTuoc ? 0 : 60;
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
                        if (!biTuoc) {
                            commission += KtvCommissionService.calcCommission(itemDuration, commConfigs, workType, item.serviceId);
                        }
                    }
                }
                // Lớp dự phòng thứ hai — cũng phải chừa đơn bị tước ra, nếu không
                // nó trả lại đúng 60 phút vừa chặn ở trên.
                if (commission === 0 && passedCount > 0 && coItemConQuyenLoi) {
                    commission = KtvCommissionService.calcCommission(60, commConfigs, workType, '');
                }

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
                let ledgerBonus: number | null = null;
                let ledgerTax: number | null = null;
                let ledgerActualDuration: number | null = null;
                let ledgerWorkDate: string | null = null;
                let mixedTeamNote: string | null = null;

                if (workType === 'TYPE_D') {
                    const led = ledgerByGroup.get(`${b.id}|${groupId0}`);
                    if (led) {
                        // Thưởng 4★ LÀ MỘT PHẦN của tiền tua, không phải khoản
                        // riêng: `tiền tua = tiền theo thời gian làm + thưởng`.
                        // Lấy thẳng từ sổ cái nên khớp tuyệt đối với ví.
                        commission = Math.round(led.commission_net + led.bonus_amount);
                        commissionBeforeDeduction = Math.round(led.commission_gross);
                        ratingDeductionRate = led.deduction_rate;
                        ledgerRating = led.rating;
                        // Thưởng 4★ đã nằm trong `commission`, nhưng màn Lịch Sử
                        // cần chỉ mặt được nó: KTV nhìn "tiền tua 168.333đ" mà
                        // "tổng thu nhập 188.333đ" thì không biết 20.000đ ở đâu ra.
                        ledgerBonus = Math.round(led.bonus_amount);
                        ledgerTax = Math.round(led.tax_amount);
                        ledgerActualDuration = Math.round(led.actual_minutes);
                        ledgerWorkDate = led.work_date ?? null;
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
                
                // Loại D KHÔNG có dòng thưởng riêng — thưởng đã nằm trong
                // `commission` bên trên.
                //
                // ⚠️ Trước đây chỗ này vẫn chạy `calculateBookingBonus` (đường
                // thưởng của A/B/C) cho cả loại D, ra một con số tính từ NGUỒN
                // KHÁC với sổ cái. Hệ quả kép: màn Lịch sử tách thưởng thành
                // dòng riêng, và `taxAmount` bên dưới cộng thêm 10% của nó lên
                // trên `ledgerTax` — mà `ledgerTax` đã gồm thuế phần thưởng rồi,
                // nên thuế bị đếm hai lần.
                let bonusPoints = 0;
                if (passedCount > 0 && workType !== 'TYPE_D') {
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

                // KTV làm cùng: chỉ người được xếp CÙNG LÀN (chồng giờ, chặng còn
                // hiệu lực). Không lấy cả `technicianCodes` — đổi KTV thì người bị
                // thay vẫn còn tên trong đó. Xem lib/co-workers.
                const coWorkers = coWorkersOfItems(groupItems, techCode);

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

                // Loại D: thuế lấy THẲNG từ sổ cái — nó đã tính trên
                // (tiền tua + thưởng) nên không cộng thêm gì nữa.
                const taxAmount = workType === 'TYPE_D'
                    ? (ledgerTax ?? 0)
                    : (isTaxed ? Math.round(grossIncome * TAX_RATE) : 0);

                return {
                    id: `${b.id}_${groupItems[0].id}`, // Đảm bảo ID duy nhất cho mỗi dòng lịch sử (BookingID + ItemID)
                    billCode: `${b.billCode}${billSuffix}`,
                    guestLabel,
                    createdAt: b.createdAt,
                    bookingDate: b.bookingDate,
                    // NGÀY LÀM VIỆC — trục ngày duy nhất của màn này, cùng trục
                    // với Ví và sổ giờ. `bookingDate` ở trên giữ lại chỉ để tra
                    // cứu, KHÔNG dùng để gom nhóm hay lọc.
                    business_date: businessDateOf(ledgerWorkDate, b),
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
                    // Tiền thưởng do khách chấm Xuất sắc. Loại D lấy thẳng từ sổ cái
                    // (thưởng đã gộp trong `commission`); A/B/C là điểm quy ra tiền.
                    ratingBonusAmount: isFeedbackDone
                        ? (workType === 'TYPE_D' ? (ledgerBonus ?? 0) : bonusValue)
                        : 0,
                    // Cùng khoản thưởng đó tính bằng ĐIỂM — đơn vị mà trang cài
                    // đặt dùng ("Điểm cơ bản mỗi tua = 20 Điểm", "Tỉ lệ quy đổi
                    // = 1000 VNĐ/1đ"). Màn Lịch Sử hiện theo điểm; tiền ở trên
                    // vẫn là nguồn duy nhất cho mọi phép tính.
                    // Loại D suy ngược từ tiền để không lệch khi tua bị chia
                    // đôi giữa 2 KTV (20.000đ / 2 → 10đ).
                    ratingBonusPoints: !isFeedbackDone ? 0
                        : (workType === 'TYPE_D'
                            ? (pointRate > 0 ? Math.round((ledgerBonus ?? 0) / pointRate) : 0)
                            : bonusPoints),
                    mixedTeamNote,
                    voidedNote,
                    voidedKind: voidedInfo?.kind ?? null,
                    voidedReason: voidedInfo?.reason ?? null,
                    // ⚠️ Bị tước quyền lợi thì kết quả ĐÃ CHỐT từ lúc quầy bấm: 0đ. Khách
                    // chấm mấy sao cũng không đổi được con số đó, nên KHÔNG được để
                    // màn hình ghi "Chờ FB" hay "Tạm tính" — đọc ra như còn hy vọng.
                    ...(voidedInfo ? {
                        isFeedbackDone: true,
                        isProvisional: false,
                        commission: 0,
                        commissionBeforeDeduction: 0,
                        grossIncome: 0,
                        netIncome: 0,
                        taxAmount: 0,
                        bonusPoints: 0,
                        bonusValue: 0,
                        tip: 0,
                        ratingDeductionRate: 0,
                        ratingDeductionAmount: 0,
                        ratingBonusAmount: 0,
                        ratingBonusPoints: 0,
                    } : {}),
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

        // ─── Lọc theo NGÀY LÀM VIỆC ────────────────────────────────────────
        // Tới đây mỗi dòng đã biết ngày làm việc thật của nó (sổ cái, hoặc mốc
        // giờ thật). Cửa sổ đơn ở trên cố tình quét rộng ±1 ngày; chỗ này cắt
        // lại đúng những ngày KTV đang chọn.
        const result = rawResult.filter((r: any) => isPickedDay(r.business_date));

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
