import type { SupabaseClient } from '@supabase/supabase-js';
import { KtvOfficeScoreService, currentMonthVn, FUND_BASE } from '@/lib/services/KtvOfficeScoreService';
import { WalletAccessService } from '@/lib/services/WalletAccessService';

/**
 * ================================================================
 * Ví Điểm của loại D lấy điểm từ ĐÂU
 * ================================================================
 * Loại D chỉ có MỘT nguồn: điểm Office — 100đ mỗi ngày đi làm, trừ dần theo
 * lỗi, lấy trung bình tháng rồi trừ phạt lỗi lặp. Loại A/B/C giữ điểm sao
 * (khách chấm ≥4★ thì cộng điểm, quy ra tiền, rút được).
 *
 * ⚠️ Trước đây có thêm cờ `bonus_from_office` để CHỌN nguồn, đứng cạnh cờ
 * `bonus_wallet` bật/tắt ví. Hai cần gạt cho cùng một thứ là thừa và đẻ ra
 * trạng thái vô nghĩa: có ví mà không có nguồn điểm, hoặc có nguồn điểm mà
 * không có ví để xem. Nay gộp làm một — loại D bật Ví Điểm là điểm theo Office.
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
    /**
     * `false` = tháng này chưa có ngày công nào → CHƯA CÓ DỮ LIỆU.
     * Màn hình phải hiện "chưa có dữ liệu", không được vẽ 100 điểm / miễn 100%
     * quỹ: chưa đi làm buổi nào mà hiện điểm tuyệt đối là nói sai sự thật.
     */
    hasData: boolean;
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
    return canSeeOfficePoints(supabase, staffId);
}

/**
 * KTV này có được XEM điểm Office không — cửa DUY NHẤT, dùng chung cho MỌI
 * màn hình (Dashboard, trang Ví, các route ví bonus).
 *
 * Hai điều kiện, cả hai đều có sẵn:
 *   1. Loại D — chỉ nhóm này có thang điểm Office.
 *   2. Ví Điểm đang mở: công tắc CẢ LOẠI và cờ `bonus_wallet` của người đó.
 *
 * ⚠️ Trước đây nút "Điểm Office" trên Dashboard không đi qua cửa nào — nó hiện
 * bất cứ khi nào API trả về số, còn trang Ví thì đòi đủ điều kiện. Tài khoản
 * `bonus_wallet = false` (ví dụ T001) thấy nút trên Dashboard mà mở ví ra không
 * có gì: hai màn hình nói hai chuyện về cùng một tính năng. Giờ chung một cửa.
 */
export async function canSeeOfficePoints(
    supabase: SupabaseClient,
    staffId: string,
): Promise<boolean> {
    const { data: staff } = await supabase
        .from('Staff')
        .select('work_type')
        .eq('id', staffId)
        .maybeSingle();

    if (!staff || staff.work_type !== 'TYPE_D') return false;

    const { ok } = await WalletAccessService.isEnabled(supabase, staffId, 'BONUS');
    return ok;
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
        hasData: s.hasData,
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

/**
 * Đánh dấu ảnh DÙNG CHUNG giữa nhiều lỗi trong cùng một ngày — KHÔNG xoá đi.
 *
 * Phiếu ghi TRƯỚC bản vá "ảnh theo từng lỗi" dùng chung một rổ: tích 8 lỗi, tải
 * 1 ảnh thì cả 8 dòng cùng mang đúng link đó. Trên dữ liệu thật, T016 ngày
 * 05/09 đúng như vậy.
 *
 * ⚠️ BẢN ĐẦU CỦA HÀM NÀY ĐI XOÁ ẢNH TRÙNG — và đó là một sai lầm. Nó khiến 7
 * trong 8 lỗi của ngày 05/09 hiện "0 ảnh", tức là KTV đang xem được bằng chứng
 * thì mất sạch. Với người bị trừ điểm và muốn khiếu nại, "không có ảnh" tệ hơn
 * hẳn "ảnh dùng chung": ảnh lặp thì khó nhìn, còn ảnh biến mất thì họ không còn
 * gì để đối chiếu, và quầy cũng không chứng minh được đã chụp.
 *
 * Nay giữ NGUYÊN ảnh ở mọi lỗi, chỉ gắn cờ `sharedPhotos` để màn hình nói rõ
 * "ảnh dùng chung của phiếu ngày này" — giải thích chỗ lặp thay vì giấu nó đi.
 *
 * Phiếu ghi sau bản vá vốn không dùng chung nên cờ luôn `false`.
 */
export function markSharedPhotosWithinDay<T extends { photoUrls: string[] }>(
    hits: T[],
): Array<T & { sharedPhotos: boolean }> {
    const count = new Map<string, number>();
    for (const h of hits) {
        for (const u of new Set(h.photoUrls || [])) {
            count.set(u, (count.get(u) || 0) + 1);
        }
    }
    return hits.map(h => ({
        ...h,
        sharedPhotos: (h.photoUrls || []).some(u => (count.get(u) || 0) > 1),
    }));
}

export interface OfficeBonusEntry {
    date: string;
    /** Điểm của riêng ngày đó (100 trừ các lỗi trong ngày). */
    dayScore: number;
    /** Tổng điểm bị trừ trong ngày. Ngày sạch = 0. */
    deducted: number;
    /**
     * Lỗi bị trừ trong ngày, kèm link ảnh minh chứng để KTV tự đối chiếu.
     * `sharedPhotos` = ảnh này dùng chung với lỗi khác trong ngày (phiếu cũ).
     */
    hits: Array<{
        label: string; points: number; note: string | null;
        photoCount: number; photoUrls: string[]; sharedPhotos: boolean;
        byName: string; at: string;
    }>;
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
        hits: markSharedPhotosWithinDay(d.hits.map(h => ({
            label: h.label,
            points: h.points,
            note: h.note,
            photoCount: h.photoUrls.length,
            photoUrls: h.photoUrls,
            byName: h.byName,
            at: h.at,
        }))),
    }));
}
