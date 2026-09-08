import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveStaffFlag } from '@/lib/featureFlags';
import { KtvOfficeScoreService, currentMonthVn, FUND_BASE } from '@/lib/services/KtvOfficeScoreService';

/**
 * ================================================================
 * Ví Điểm của loại D lấy điểm từ ĐÂU
 * ================================================================
 * Hai nguồn, chọn một bằng cờ `bonus_from_office` của từng nhân viên:
 *
 *   TẮT (mặc định) — điểm sao: khách chấm ≥4★ thì cộng điểm, quy ra tiền theo
 *                    đơn giá điểm, KTV rút được. Đây là hành vi cũ, giữ nguyên
 *                    cho mọi tài khoản chưa set cờ.
 *   BẬT            — điểm Office: 100đ mỗi ngày đi làm, trừ dần theo lỗi, lấy
 *                    trung bình tháng rồi trừ phạt lỗi lặp.
 *
 * ⚠️ Điểm Office KHÔNG quy ra tiền và KHÔNG rút được. Nó là thang chất lượng,
 * không phải số dư tích được. Hệ quả tiền của nó đã có sẵn trong quy chế và chỉ
 * có một: mức QUỸ NỘI BỘ còn phải đóng cuối tháng (0 / 125k / 175k / 225k /
 * 250k tuỳ bậc điểm). Tự chế thêm tỉ giá điểm→tiền là đẻ ra một đường tiền thứ
 * hai không có trong quy chế, và KTV sẽ đòi rút đúng số đó.
 *
 * Vì vậy khi cờ bật thì nút "Yêu cầu quy đổi tiền" phải biến mất, và route rút
 * tiền phải chặn ở tầng server — ẩn nút không phải là chặn.
 */

export interface OfficeBonusWallet {
    /** Luôn là 'OFFICE' — để client biết vẽ thẻ nào mà không phải tự đoán. */
    source: 'OFFICE';
    /** 'YYYY-MM' của kỳ đang tính. */
    month: string;
    /** Điểm tháng (đã trừ phạt lỗi lặp) — con số chính hiện trên thẻ. */
    points: number;
    /** Trung bình điểm ngày, TRƯỚC khi trừ phạt lỗi lặp. */
    avg: number;
    workDays: number;
    cleanDays: number;
    /** Tổng điểm bị trừ thêm do cùng một lỗi lặp ≥3 lần trong tháng. */
    repeatPenalty: number;
    repeats: Array<{ criteriaId: string; label: string; times: number; points: number }>;
    /** % được miễn quỹ nội bộ theo bậc điểm. */
    exemptPct: number;
    /** Số tiền CÒN PHẢI ĐÓNG (không phải số được miễn). */
    fundDue: number;
    /** Quỹ gốc mỗi tháng, để client hiện "x / 250.000đ". */
    fundBase: number;
    /** Điểm Office không đổi ra tiền được. */
    redeemable: false;
}

/**
 * KTV này đang dùng Ví Điểm theo Office chứ không phải điểm sao?
 *
 * Chỉ áp dụng cho loại D — các loại khác không có thang điểm Office nào để đọc.
 */
export async function usesOfficeBonus(
    supabase: SupabaseClient,
    staffId: string,
): Promise<boolean> {
    const { data: staff } = await supabase
        .from('Staff')
        .select('work_type, feature_flags')
        .eq('id', staffId)
        .maybeSingle();

    if (!staff || staff.work_type !== 'TYPE_D') return false;
    return resolveStaffFlag((staff as any).feature_flags, 'bonus_from_office');
}

/** Số liệu Ví Điểm lấy từ điểm Office của một tháng. */
export async function officeBonusBalance(
    supabase: SupabaseClient,
    staffId: string,
    month?: string,
): Promise<OfficeBonusWallet> {
    const m = /^\d{4}-\d{2}$/.test(month || '') ? month! : currentMonthVn();
    const scores = await KtvOfficeScoreService.computeMonth(supabase, [staffId], m);
    const s = scores.get(staffId)!;

    return {
        source: 'OFFICE',
        month: m,
        points: s.final,
        avg: s.avg,
        workDays: s.workDays,
        cleanDays: s.cleanDays,
        repeatPenalty: s.repeatPenalty,
        repeats: s.repeats,
        exemptPct: s.exemptPct,
        fundDue: s.fundDue,
        fundBase: FUND_BASE,
        redeemable: false,
    };
}

export interface OfficeBonusEntry {
    date: string;
    /** Điểm của riêng ngày đó (100 trừ các lỗi trong ngày). */
    dayScore: number;
    /** Tổng điểm bị trừ trong ngày. Ngày sạch = 0. */
    deducted: number;
    /** Lỗi bị trừ trong ngày, kèm link ảnh minh chứng để KTV tự đối chiếu. */
    hits: Array<{ label: string; points: number; note: string | null; photoCount: number; photoUrls: string[]; byName: string; at: string }>;
}

/**
 * Lịch sử theo NGÀY để hiện dưới thẻ Ví Điểm.
 *
 * Mới nhất trước, và giữ cả ngày sạch: KTV phải đối chiếu được từng ngày, chứ
 * chỉ liệt kê ngày có lỗi thì nhìn như tháng nào cũng toàn vi phạm.
 */
export async function officeBonusTimeline(
    supabase: SupabaseClient,
    staffId: string,
    month?: string,
): Promise<OfficeBonusEntry[]> {
    const m = /^\d{4}-\d{2}$/.test(month || '') ? month! : currentMonthVn();
    const scores = await KtvOfficeScoreService.computeMonth(supabase, [staffId], m);
    const s = scores.get(staffId)!;

    // `days` đã được sắp mới-nhất-trước trong buildMonth.
    return s.days.map(d => ({
        date: d.workDate,
        dayScore: d.dayScore,
        deducted: Math.round(d.hits.reduce((a, h) => a + h.points, 0) * 100) / 100,
        hits: d.hits.map(h => ({
            label: h.label,
            points: h.points,
            note: h.note,
            photoCount: h.photoUrls.length,
            photoUrls: h.photoUrls,
            byName: h.byName,
            at: h.at,
        })),
    }));
}
