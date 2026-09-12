import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { ratingLabel } from '@/lib/rating-label';
import { KtvWalletService } from '@/lib/services/KtvWalletService';
import { KtvTypeDCommissionService } from '@/lib/services/KtvTypeDCommissionService';
import { WalletAccessService } from '@/lib/services/WalletAccessService';
import { getDayCutoffHours, toBusinessDate } from '@/lib/business-date';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Sắp xếp để hiển thị: mới nhất lên trên. Cùng một mốc thời gian thì dòng TRỪ
 * đứng trên dòng CỘNG.
 *
 * Nghe ngược, nhưng đúng với cách đọc danh sách này: trên cùng là mới nhất.
 * Trong một đơn, tiền tua vào trước rồi mới trừ thuế — nên thuế là việc xảy ra
 * SAU, phải nằm TRÊN. Nhờ vậy dòng trên cùng luôn mang số dư hiện tại, đọc
 * xuống dưới là lùi dần về quá khứ.
 *
 * Tiền tua, thưởng và thuế của một đơn dùng chung đúng một `created_at`, nên
 * thứ tự giữa chúng hoàn toàn do tiêu chí phụ này quyết định — trước đây không
 * có tiêu chí nào, thứ tự chỉ nhờ `Array.sort` giữ nguyên thứ tự chèn.
 */
function sortForDisplay(timeline: any[]): void {
    timeline.sort((a, b) => {
        const dt = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (dt !== 0) return dt;
        // Cùng mốc: trừ (< 0) lên trên cộng (>= 0).
        return (Number(a.amount) < 0 ? 0 : 1) - (Number(b.amount) < 0 ? 0 : 1);
    });
}

/**
 * Đánh dấu mốc thời gian của Bookings là UTC.
 *
 * `Bookings.timeStart` / `timeEnd` / `createdAt` và `KTVDTurnLedger.booking_time_start`
 * đều là `timestamp WITHOUT time zone`, và giá trị bên trong là giờ UTC —
 * kiểm chứng: booking vừa tạo có `createdAt` khớp `now() AT TIME ZONE 'UTC'`,
 * lệch 7 tiếng so với giờ VN.
 *
 * PostgREST trả chúng dưới dạng `"2026-09-08T14:02:01"` KHÔNG có `Z`, nên
 * `new Date(...)` trên trình duyệt hiểu là GIỜ ĐỊA PHƯƠNG và hiện sớm 7 tiếng.
 *
 * ⚠️ Đây là lỗi có thật, KTV phát hiện ra: T079 điểm danh 17:26 mà lịch sử ghi
 * làm tua lúc 12:04 và 14:02 — chưa điểm danh sao gán được dịch vụ. Giờ làm
 * thật (`segments.actualStartTime`, chuỗi ISO có `Z`) là 19:04 và 21:02, tức
 * đúng sau lúc điểm danh. Cộng `Z` vào là ba mốc khớp nhau.
 *
 * `KtvDLedgerEngine` đã xử lý y hệt khi tính ngày làm việc — chỗ hiển thị chỉ
 * là nốt còn sót.
 */
function asUtcIso(raw: any): string | null {
    if (!raw) return null;
    const v = String(raw);
    // Đã mang sẵn múi giờ (`...Z` hoặc `...+07:00`) thì để nguyên.
    return /[Z+]|-\d{2}:\d{2}$/.test(v.slice(10)) ? v : `${v.replace(' ', 'T')}Z`;
}

/**
 * Gắn NGÀY LÀM VIỆC cho từng dòng, để màn Ví gom nhóm theo đúng ngày của spa.
 *
 * Spa chốt ngày lúc `cutoffHours` (mặc định 6h sáng), nên tua chạy sau nửa đêm
 * vẫn thuộc ngày làm việc hôm trước.
 *
 * ⚠️ Trước đây trang Ví tự dựng khoá nhóm bằng
 * `new Date(created_at).toLocaleDateString(...)` — tức NGÀY LỊCH, không xét
 * cutoff. Ca thật: đơn `007-10092026-A` làm lúc 00:57 sáng 11/09 thuộc ngày làm
 * việc 10/09 (sổ cái ghi `work_date = 2026-09-10`), nhưng Ví xếp nó vào nhóm
 * 11/09 — một nhóm trộn hai ngày làm việc, lệch hẳn với sổ giờ và màn Office.
 *
 * Suy từ `created_at` là đủ cho MỌI loại dòng, kể cả dòng tua loại D: sổ cái
 * cũng tính `work_date` bằng chính `toBusinessDate` trên cùng mốc giờ đó, nên
 * hai con số luôn trùng nhau. Quét một lượt cuối như đây thì dòng nào thêm về
 * sau cũng tự có, khỏi phải nhớ gắn ở từng chỗ `push`.
 */
function attachBusinessDate(timeline: any[], cutoffHours: number): void {
    for (const item of timeline) {
        const ms = Date.parse(String(item.created_at ?? item.date ?? ''));
        item.business_date = Number.isFinite(ms) ? toBusinessDate(new Date(ms), cutoffHours) : null;
    }
}

/**
 * Gắn số dư luỹ kế vào từng dòng: số dư của ví NGAY SAU giao dịch đó.
 *
 * Cộng dồn theo thứ tự THỜI GIAN (cũ → mới); cùng mốc thì cộng tiền trước rồi
 * mới trừ, tức đúng chiều ngược với thứ tự hiển thị. Nhờ vậy dòng trên cùng
 * của danh sách mang số dư hiện tại.
 *
 * Tip không tính vào số dư ví (KTV cầm tiền mặt trực tiếp), dòng bị từ chối
 * cũng không.
 *
 * ⚠️ Nhánh loại D trước đây `return` trước khi tới đoạn này nên MỌI dòng đều
 * thiếu `running_balance`, giao diện đổ về 0 — KTV vừa được cộng 33.333đ mà
 * dòng nào cũng ghi "Số dư: 0đ".
 */
/**
 * Dòng này có được tính vào SỐ DƯ chưa.
 *
 * Phải khớp đúng định nghĩa của `KtvWalletService.getBalance` — hai bên lệch
 * nhau là màn Ví hiện hai con số khác nhau (T069 từng lệch 10.500đ vì số dư lớn
 * bỏ tua tạm tính còn số dư luỹ kế thì cộng vào).
 *
 * KHÔNG tính:
 *  · TIP — không nằm trong ví
 *  · dòng bị từ chối
 *  · tua CHƯA CHỐT: loại D `is_provisional` (chờ khách đánh giá), A/B/C `HELD`
 *    (đang tạm giữ). `getBalance` cũng chỉ cộng tua đã qua `checkIsItemPassed`.
 *
 * ⚠️ Lệnh rút tiền `PENDING` thì VẪN TÍNH — số dư lớn đã trừ `total_pending`.
 * Nên không được chặn theo `status === 'PENDING'` chung chung.
 */
function countsTowardBalance(item: any): boolean {
    if (item.type === 'TIP') return false;
    if (item.status === 'REJECTED') return false;
    if (item.is_provisional === true) return false;
    if (item.status === 'HELD') return false;
    return true;
}

function attachRunningBalance(timeline: any[], minDeposit = 0): void {
    const asc = timeline.slice().sort((a, b) => {
        const dt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (dt !== 0) return dt;
        return (Number(a.amount) < 0 ? 1 : 0) - (Number(b.amount) < 0 ? 1 : 0);
    });

    let balance = 0;
    for (const item of asc) {
        if (countsTowardBalance(item)) {
            balance += Number(item.amount);
        }
        item.running_balance = balance - minDeposit;
    }
}

/**
 * Điều chỉnh + rút tiền — phần chung cho MỌI chế độ.
 * Tách ra để nhánh loại D (đọc sổ cái) và nhánh A/B/C (đường cũ) dùng chung,
 * không phải chép đôi.
 */
async function appendAdjustmentsAndWithdrawals(
    supabase: any, techCode: string, workType: string, startDate: string, timeline: any[]
) {
    const { data: adjustments } = await KtvWalletService.applySnapshotFilter(
        supabase.from('WalletAdjustments').select('id, amount, reason, type, created_at').eq('staff_id', techCode),
        workType
    ).gte('created_at', startDate);

    (adjustments || []).forEach((a: any) => {
        let title = Number(a.amount) >= 0 ? 'Thưởng hệ thống' : 'Trừ tiền hệ thống';
        const reason = (a.reason || '').toLowerCase();
        if (reason.includes('giặt đồ')) title = '🧦 Giặt đồ hàng ngày';
        else if (reason.includes('nghỉ đột xuất')) title = '⚠️ Phạt nghỉ đột xuất';

        timeline.push({
            id: a.id,
            type: Number(a.amount) >= 0 ? 'GIFT' : 'ADJUSTMENT',
            title,
            amount: a.amount,
            note: a.reason || '',
            created_at: a.created_at,
            status: 'APPROVED',
        });
    });

    const { data: withdrawals } = await KtvWalletService.applySnapshotFilter(
        supabase.from('KTVWithdrawals').select('id, amount, note, request_date, status').eq('staff_id', techCode),
        workType
    ).or('wallet_type.eq.TUA,wallet_type.is.null').gte('request_date', startDate);

    (withdrawals || []).forEach((w: any) => {
        // Ẩn dòng "Báo trước lúc điểm danh" (amount = 1, chỉ là tín hiệu báo Thu ngân).
        const isIntent = Math.abs(Number(w.amount)) === 1 && w.note && w.note.includes('Báo trước');
        if (isIntent) return;

        timeline.push({
            id: w.id,
            type: 'WITHDRAWAL',
            title: 'Rút tiền mặt',
            amount: -Math.abs(Number(w.amount)),
            note: w.note || '',
            created_at: w.request_date,
            status: w.status,
        });
    });
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');

        if (!techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }

        const denied = await WalletAccessService.denyIfDisabled(supabase, techCode, 'TUA');
        if (denied) return denied;

        // ─── Resolve workType from Staff (Mới nhất) ───
        let workType = 'TYPE_A'; // Default
        const { data: staffData } = await supabase.from('Staff')
            .select('work_type').eq('id', techCode).single();
        if (staffData && staffData.work_type) {
            workType = staffData.work_type;
        }

        const commConfigs = await KtvCommissionService.getAllConfigs(supabase);
        let rateVIP = 180000;
        let ratePT = 100000;
        let ratingDeductions: Record<string, number> = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
        let taxEffectiveDate = '2099-01-01';

        if (workType === 'TYPE_D') {
            const { data: configsData } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
            const configs: Record<string, any> = {};
            (configsData || []).forEach(c => { configs[c.key] = c.value; });
            
            taxEffectiveDate = configs['ktv_type_d_tax_effective_from'] || '2099-01-01';

            rateVIP = Number(configs['ktv_type_d_vip_rate_per_60m']) || 180000;
            ratePT = Number(configs['ktv_type_d_pt_rate_per_60m']) || 100000;
            try {
                if (configs['ktv_type_d_rating_deduction']) {
                    ratingDeductions = typeof configs['ktv_type_d_rating_deduction'] === 'string' 
                        ? JSON.parse(configs['ktv_type_d_rating_deduction']) 
                        : configs['ktv_type_d_rating_deduction'];
                }
            } catch (e) {}
        }

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const START_DATE = `${GLOBAL_START_DATE_STR}T00:00:00.000Z`;
        const timeline: any[] = [];

        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // ═══ LOẠI D: dựng từ SỔ CÁI, mỗi tua một dòng ═══════════════════════
        // Tách hẳn khỏi đường A/B/C. Trước đây nhánh này tự tính lại hoa hồng
        // nên lệch với lịch sử và với số dư ví; nay cả ba cùng đọc
        // KTVDTurnLedger. Sổ cái lưu KHÔNG làm tròn → làm tròn ở đây.
        //
        // Khác đường cũ ở chỗ hiển thị: cũ gộp thành "Tổng tiền tua ngày X",
        // nay tách từng tua kèm mã bill để KTV đối chiếu được với lịch sử.
        if (workType === 'TYPE_D') {
            const { drainQueueFor } = await import('@/lib/services/KtvDLedgerWriter');
            const { getRows, groupForHistory } = await import('@/lib/services/KtvDLedgerReader');

            const turnRows = await getRows(supabase, {
                staffIds: [techCode], from: GLOBAL_START_DATE_STR, to: '2099-12-31',
            });

            // Tua vừa xong có thể còn trong hàng đợi (worker 5 phút/lần).
            try {
                await drainQueueFor(supabase, [...new Set(turnRows.map(r => r.booking_id))]);
            } catch { /* không chặn hiển thị */ }

            for (const g of groupForHistory(turnRows)) {
                const at = asUtcIso(g.rows[0].booking_time_start) || `${g.work_date}T12:00:00+07:00`;

                // Tiền tua và thưởng 4★ là MỘT CỤC, đúng như công thức:
                //     tiền tua = tiền theo thời gian làm + thưởng
                //
                // ⚠️ Tách làm hai dòng thì KTV phải tự cộng nhẩm mới ra con số
                // mà quy chế nói, và dòng thuế bên dưới trông như đánh trên
                // riêng phần tiền tua. Ghi chú cũng KHÔNG tách phần thưởng ra:
                // nói "gồm thưởng X" là lại gợi ý đây là hai khoản ghép lại.
                const tienTua = g.commission_net + g.bonus_amount;
                if (tienTua > 0) {
                    /**
                     * Kết quả đánh giá, kèm SỐ TIỀN nó làm ra hoặc lấy đi.
                     *
                     * ⚠️ Trước đây chỗ này chỉ mở miệng khi BỊ TRỪ, và cũng chỉ ghi
                     * "3★ trừ 25%" — không có số tiền. Được thưởng thì im hẳn, nên
                     * tua 4★ hiện lên ví với một con số to hơn bình thường mà không
                     * dòng nào nói vì sao. Gọi tên mức sao bằng `ratingLabel` để ví
                     * và màn Lịch Sử đọc ra cùng một chữ.
                     */
                    const ketQuaDanhGia = (() => {
                        const ten = ratingLabel(g.rating);
                        if (!ten) return '';
                        if (g.bonus_amount > 0) {
                            return ` · ${ten} +${Math.round(g.bonus_amount).toLocaleString('vi-VN')}đ`;
                        }
                        if (g.deduction_rate > 0) {
                            const truTien = Math.round(g.commission_gross - g.commission_net);
                            const pct = Math.round(g.deduction_rate * 100);
                            return ` · ${ten} −${pct}%` + (truTien > 0 ? ` (−${truTien.toLocaleString('vi-VN')}đ)` : '');
                        }
                        return '';
                    })();

                    // ⚠️ KHÔNG làm tròn số tiền ở đây. Làm tròn TỪNG DÒNG rồi
                    // mới cộng thì tổng lệch với số dư thật — T016 lệch +1,28đ
                    // giữa ô "Số dư hiện tại" và số dư dưới dòng timeline.
                    // Phần lẻ được cắt ở tầng hiển thị bằng `formatVnd`.
                    timeline.push({
                        id: `${g.key}_comm`,
                        type: 'COMMISSION',
                        title: `Tiền tua đơn ${g.bill}`,
                        amount: tienTua,
                        note: `${g.service_name} · ${Math.round(g.paid_minutes)} phút`
                            + ketQuaDanhGia
                            + (g.is_provisional ? ' · tạm tính' : ''),
                        created_at: at,
                        status: g.is_provisional ? 'PENDING' : 'APPROVED',
                        is_provisional: g.is_provisional,
                    });
                }
                if (g.tax_amount > 0) {
                    timeline.push({
                        id: `${g.key}_tax`,
                        type: 'ADJUSTMENT',
                        title: `Thuế TNCN đơn ${g.bill}`,
                        amount: -g.tax_amount,
                        note: 'Khấu trừ 10%',
                        created_at: at,
                        status: 'APPROVED',
                        // Thuế của tua tạm tính cũng là tạm tính: khách đổi mức
                        // đánh giá là tiền tua đổi, thuế đổi theo.
                        is_provisional: g.is_provisional,
                    });
                }
                if (g.tip > 0) {
                    timeline.push({
                        id: `${g.key}_tip`,
                        type: 'TIP',
                        title: `Tiền Tip đơn ${g.bill}`,
                        amount: g.tip,
                        note: '',
                        created_at: at,
                        status: 'APPROVED',
                    });
                }
            }

            await appendAdjustmentsAndWithdrawals(supabase, techCode, workType, START_DATE, timeline);
            attachBusinessDate(timeline, await getDayCutoffHours(supabase));
            attachRunningBalance(timeline);
            sortForDisplay(timeline);
            return NextResponse.json({ success: true, data: timeline });
        }

        // 1. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay để tránh đụng độ Realtime)
        const { data: ledgers } = await KtvWalletService.applySnapshotFilter(
            supabase.from('KTVDailyLedger').select('date, total_commission, total_tip').eq('staff_id', techCode),
            workType
        )
            .gte('date', GLOBAL_START_DATE_STR);

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;

        if (ledgers && ledgers.length > 0) {
            const pastLedgers = ledgers.filter((l: any) => l.date < todayStr);
            
            if (pastLedgers.length > 0) {
                let maxDateStr = pastLedgers[0].date;
                pastLedgers.forEach((l: any) => {
                    if (l.date > maxDateStr) maxDateStr = l.date;
                    
                    let dayComm = Number(l.total_commission) || 0;
                    if (l.date >= taxEffectiveDate) {
                        dayComm = dayComm * 0.9;
                    }

                    if (dayComm > 0) {
                        timeline.push({
                            id: `ledger_comm_${l.date}`,
                            type: 'COMMISSION',
                            title: `Tổng tiền tua ngày ${l.date.split('-').reverse().join('/')}`,
                            amount: dayComm,
                            note: 'Chốt sổ cái',
                            created_at: `${l.date}T23:59:59+07:00`,
                            status: 'APPROVED'
                        });
                    }
                    if (Number(l.total_tip) > 0) {
                        timeline.push({
                            id: `ledger_tip_${l.date}`,
                            type: 'TIP',
                            title: `Tổng tiền tip ngày ${l.date.split('-').reverse().join('/')}`,
                            amount: Number(l.total_tip),
                            note: 'Chốt sổ cái',
                            created_at: `${l.date}T23:59:59+07:00`,
                            status: 'APPROVED'
                        });
                    }
                });

                const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
                const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
                const nextDateStr = nextDateVn.toISOString().split('T')[0];
                
                realtimeStartStr = `${nextDateStr}T00:00:00+07:00`;
            }
        }

        // 2. Commission & Tips (from Bookings & BookingItems) CHỈ lấy từ ngày hiện tại
        let allBookingItems: any[] = [];
        let page = 0;
        const pageSize = 1000;
        
        while (true) {
            const { data, error } = await supabase
                .from('BookingItems')
                .select(`
                    id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options, handover_status, handover_comment,
                    Bookings!inner ( id, timeStart, timeEnd, status, technicianCode, billCode, createdAt )
                `)
                .contains('technicianCodes', [techCode])
                .gte('Bookings.timeStart', realtimeStartStr)
                .not('Bookings.status', 'in', '("CANCELLED","NEW")')
                .range(page * pageSize, (page + 1) * pageSize - 1);
                
            if (error) {
                console.error("Pagination error timeline:", error);
                break;
            }
            if (!data || data.length === 0) break;
            allBookingItems = allBookingItems.concat(data);
            page++;
        }

        const bookingsMap: Record<string, any> = {};
        allBookingItems.forEach(item => {
            const b = item.Bookings;
            if (!bookingsMap[b.id]) {
                bookingsMap[b.id] = { ...b, BookingItems: [] };
            }
            const cleanItem = { ...item };
            delete cleanItem.Bookings;
            bookingsMap[b.id].BookingItems.push(cleanItem);
        });
        const bookings = Object.values(bookingsMap);

        const { data: services } = await supabase.from('Services').select('id, duration, is_utility');
        const svcDurationMap: Record<string, number> = {};
        const svcUtilityMap: Record<string, boolean> = {};
        (services || []).forEach(s => { 
            svcDurationMap[String(s.id)] = s.duration || 0; 
            svcUtilityMap[String(s.id)] = !!s.is_utility; 
        });

        const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

        for (const b of validBookings) {
            // 🧠 Filter theo ITEM STATUS thay vì Booking cha — triệt tiêu kẹt tiền
            const DONE_STATUSES = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
            const relevantItemsOriginal = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes &&
                Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase())) &&
                DONE_STATUSES.includes(i.status)
            );

            let relevantItems = relevantItemsOriginal.filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
            if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
                relevantItems = relevantItemsOriginal;
            }

            if (relevantItems.length === 0) continue;

            let passedDuration = 0;
            let passedCommission = 0;
            let heldDuration = 0;
            let heldCommission = 0;
            let allHoldReasons = new Set<string>();
            let passedCount = 0;

            
            if (workType === 'TYPE_D') {
                const vipItems = relevantItems.filter((i: any) => {
                    const svcId = String(i.serviceId).toUpperCase();
                    return svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP');
                });
                const ptItems = relevantItems.filter((i: any) => {
                    const svcId = String(i.serviceId).toUpperCase();
                    return !(svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP'));
                });
                
                passedCommission = KtvTypeDCommissionService.calculateGuestCommission(vipItems, techCode, b.rating, rateVIP, ratingDeductions) + 
                                   KtvTypeDCommissionService.calculateGuestCommission(ptItems, techCode, b.rating, ratePT, ratingDeductions);
                
                // For TYPE_D, we don't hold commission (no HOLD logic defined in requirements)
                heldCommission = 0;
                
                // Approximate passedDuration
                passedDuration = relevantItems.reduce((sum: number, item: any) => {
                    const biTuoc = KtvCommissionService.isKtvVoidedOnItem(item, techCode);
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = biTuoc ? 0 : 60;
                    return sum + itemDuration;
                }, 0);
                
                passedCount = relevantItems.length;
            } else {
                // Dịch vụ mà KTV đã bị TƯỚC quyền lợi (đổi ra, huỷ không công).
                // Xem KtvCommissionService.isKtvVoidedOnItem để hiểu vì sao không
                // được dựa vào `itemDuration <= 0` để nhận ra chuyện này.
                const coItemConQuyenLoi = relevantItems.some(
                    (i: any) => !KtvCommissionService.isKtvVoidedOnItem(i, techCode)
                );

                for (const item of relevantItems) {
                    const biTuoc = KtvCommissionService.isKtvVoidedOnItem(item, techCode);
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    // Dự phòng 60 phút chỉ dành cho đơn THIẾU DỮ LIỆU, không dành cho
                    // đơn bị tước — bị tước là đúng 0.
                    if (itemDuration <= 0) itemDuration = biTuoc ? 0 : 60;

                    const commissionForItem = biTuoc
                        ? 0
                        : KtvCommissionService.calcCommission(itemDuration, commConfigs, workType, item.serviceId);

                    const { isPassed, reasons } = KtvCommissionService.checkIsItemPassed(item, b, techCode);

                    if (isPassed) {
                        passedDuration += itemDuration;
                        passedCommission += commissionForItem;
                        passedCount++;
                    } else {
                        heldDuration += itemDuration;
                        heldCommission += commissionForItem;
                        reasons.forEach(r => allHoldReasons.add(r));
                    }
                }

                // Fallback for TYPE_A if total passed commission is 0 but they did work.
                // Chừa đơn bị tước ra, nếu không nó trả lại đúng 60 phút vừa chặn ở trên.
                if (passedCommission === 0 && passedCount > 0 && coItemConQuyenLoi) {
                    passedCommission = KtvCommissionService.calcCommission(60, commConfigs, workType, '');
                }
                if (heldCommission === 0 && relevantItems.length > passedCount && passedCount === 0 && coItemConQuyenLoi) {
                    heldCommission = KtvCommissionService.calcCommission(60, commConfigs, workType, '');
                }
            }

            const bookingDate = (b.timeStart || b.createdAt || '').substring(0, 10);
            if (workType === 'TYPE_D' && bookingDate >= taxEffectiveDate) {
                passedCommission = passedCommission * 0.9;
                heldCommission = heldCommission * 0.9;
            }

            if (passedCommission > 0) {
                timeline.push({
                    id: b.id + '_comm_passed',
                    type: 'COMMISSION',
                    title: `Tiền tua đơn ${b.billCode || b.id.substring(0,6)}`,
                    amount: passedCommission,
                    note: `Tổng thời gian: ${passedDuration} phút`,
                    created_at: asUtcIso(b.timeStart) || asUtcIso((b as any).createdAt),
                    status: 'APPROVED'
                });
            }

            if (heldCommission > 0) {
                timeline.push({
                    id: b.id + '_comm_held',
                    type: 'COMMISSION',
                    title: `Tiền tua đơn ${b.billCode || b.id.substring(0,6)} (Đang tạm giữ)`,
                    amount: heldCommission,
                    note: Array.from(allHoldReasons).join(', '),
                    created_at: asUtcIso(b.timeStart) || asUtcIso((b as any).createdAt),
                    status: 'HELD'
                });
            }

            const ktvTip = relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
            if (ktvTip > 0) {
                timeline.push({
                    id: b.id + '_tip',
                    type: 'TIP',
                    title: `Tiền Tip đơn ${b.billCode || b.id.substring(0,6)}`,
                    amount: ktvTip,
                    note: '',
                    created_at: asUtcIso(b.timeEnd) || asUtcIso(b.createdAt),
                    status: 'APPROVED'
                });
            }
        }

        await appendAdjustmentsAndWithdrawals(supabase, techCode, workType, START_DATE, timeline);

        // A/B/C trừ thêm tiền cọc khỏi số dư hiển thị — quy chế của các chế độ
        // này. Loại D không trừ, nên dòng trên cùng khớp thẳng số dư thẻ ví.
        const activeConfig = commConfigs[workType] || commConfigs['TYPE_A'];
        attachBusinessDate(timeline, await getDayCutoffHours(supabase));
        attachRunningBalance(timeline, activeConfig.minDeposit);

        // Sort timeline desc for display
        sortForDisplay(timeline);

        return NextResponse.json({ success: true, data: timeline });
    } catch (err: any) {
        console.error('Exception timeline:', err);
        return NextResponse.json({ success: false, error: 'Internal Error' }, { status: 500 });
    }
}
