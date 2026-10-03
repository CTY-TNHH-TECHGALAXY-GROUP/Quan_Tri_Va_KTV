import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * NGÀY LÀM VIỆC (BUSINESS DATE)
 * ================================================================
 * Nguồn duy nhất để trả lời: "việc này thuộc ngày làm việc nào?"
 *
 * Spa mở qua nửa đêm, nên ngày làm việc KHÔNG trùng ngày lịch. Mốc cắt
 * là `spa_day_cutoff_hours` (mặc định 7 = 07:00 sáng): mọi việc xảy ra
 * TRƯỚC giờ này được tính vào ngày làm việc hôm trước.
 *
 *   tua kết thúc 01:00 ngày 10/09  →  ngày làm việc 09/09
 *   tua kết thúc 08:00 ngày 10/09  →  ngày làm việc 10/09
 *
 * ⚠️ Cutoff PHẢI lớn hơn giờ kết thúc tua muộn nhất trong đêm (hiện ~01:00),
 * nếu không tua ca đêm sẽ bị đẩy sang ngày mới — kéo theo giờ tích lũy sai
 * và KTV bị chấm vắng oan ở ngày mình không đăng ký làm.
 *
 * Trước đây mỗi module tự tính một kiểu, và có chỗ trộn 2 hệ: lấy ngày theo
 * cutoff nhưng lại truy vấn theo mốc nửa đêm → tua ca đêm biến mất. Mọi nơi
 * cần ngày làm việc phải dùng file này.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Dùng khi SystemConfigs chưa có `spa_day_cutoff_hours`. */
export const DEFAULT_DAY_CUTOFF_HOURS = 7;

/**
 * Đọc `spa_day_cutoff_hours` từ SystemConfigs.
 * Trả về mặc định khi thiếu config hoặc giá trị không hợp lệ.
 */
export async function getDayCutoffHours(supabase: SupabaseClient): Promise<number> {
    try {
        const { data } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_day_cutoff_hours')
            .maybeSingle();

        // SystemConfigs.value là jsonb → có thể về dạng số, chuỗi, hoặc chuỗi có nháy.
        const raw = typeof data?.value === 'string'
            ? data.value.replace(/"/g, '').trim()
            : data?.value;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n >= 24) return DEFAULT_DAY_CUTOFF_HOURS;
        return n;
    } catch {
        return DEFAULT_DAY_CUTOFF_HOURS;
    }
}

/**
 * Thời điểm `at` thuộc ngày làm việc nào. Trả về 'YYYY-MM-DD'.
 */
export function toBusinessDate(at: Date, cutoffHours: number): string {
    // Đổi sang giờ VN rồi lùi thêm `cutoffHours`; phần ngày còn lại là ngày làm việc.
    const shifted = new Date(at.getTime() + VN_OFFSET_MS - cutoffHours * HOUR_MS);
    return shifted.toISOString().slice(0, 10);
}

/**
 * Khoảng thời gian thực của một ngày làm việc, dạng ISO (UTC).
 *
 * Nửa mở `[startIso, endIso)` — dùng `.gte(start)` + `.lt(end)` khi truy vấn.
 * Với cutoff = 7, ngày 09/09 chạy từ 09/09 07:00 đến 10/09 07:00 giờ VN.
 *
 * ⚠️ CÁI BẪY — `Bookings.timeStart` là `timestamp` KHÔNG timezone, lưu theo
 * giờ UTC. PostgREST trả về dạng "2026-09-04T07:40:00" (không có `Z`), khác
 * với các cột `timestamptz` như `KTVServiceHoursLedger.created_at`
 * ("...+00:00"). Khi so sánh, Postgres cast chuỗi sang `timestamp` và **bỏ
 * qua phần offset**. Nên:
 *
 *   `${d}T00:00:00+07:00`  →  naive `d 00:00`  →  thực chất là VN d 07:00
 *
 * Đó là lý do cửa sổ cũ hành xử như cutoff = 7 và phớt lờ config. Hàm này
 * trả `.toISOString()` nên phần UTC khớp thẳng với dữ liệu lưu — đúng cho cả
 * cột naive-UTC lẫn cột `timestamptz` thật.
 */
export function businessDayRange(
    dateStr: string,
    cutoffHours: number
): { startIso: string; endIso: string } {
    const midnightVn = new Date(`${dateStr}T00:00:00+07:00`).getTime();
    const start = new Date(midnightVn + cutoffHours * HOUR_MS);
    const end = new Date(start.getTime() + 24 * HOUR_MS);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Ngày làm việc hiện tại ('YYYY-MM-DD').
 * Truyền `at` để tính cho một thời điểm khác (test, backfill).
 */
export async function getBusinessToday(supabase: SupabaseClient, at: Date = new Date()): Promise<string> {
    const cutoffHours = await getDayCutoffHours(supabase);
    return toBusinessDate(at, cutoffHours);
}

/**
 * Ngày làm việc liền trước `dateStr` — ngày mà cron chốt sổ cần xử lý.
 */
export function previousBusinessDate(dateStr: string): string {
    return shiftBusinessDate(dateStr, -1);
}

/**
 * Dịch một chuỗi 'YYYY-MM-DD' đi `days` ngày (âm = lùi).
 *
 * Dùng để suy ra "hôm qua theo ngày làm việc" từ ngày làm việc hôm nay, thay vì
 * lấy `Date.now() − 86400000` rồi cắt chuỗi: cách đó bỏ qua mốc cắt 06:00 nên
 * trong khung 00:00–06:00 nó trả về ngày lịch, lệch một ngày so với chấm công
 * và sổ cái tua.
 */
export function shiftBusinessDate(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * 'HH:mm' → số phút tính từ lúc ngày làm việc bắt đầu.
 *
 * Cắt 07:00 thì 07:00 → 0, 20:00 → 780, 23:59 → 1019, 01:50 → 1130.
 * Nhờ vậy so hai mốc giờ trong CÙNG một ngày làm việc là so hai số, không còn
 * cảnh 23:00 bị coi là muộn hơn 01:50 chỉ vì chuỗi 'HH:mm' lớn hơn.
 */
export function phutTrongNgayLamViec(hhmm: string, cutoffHours: number): number | null {
    const m = String(hhmm ?? '').match(/^(\d{2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return (h * 60 + min - cutoffHours * 60 + 1440) % 1440;
}

/**
 * `moc` đã trôi qua so với `bayGio` chưa, tính trong cùng một ngày làm việc.
 * Trả `null` khi một trong hai giá trị không phải 'HH:mm'.
 */
export function daQuaGio(moc: string, bayGio: string, cutoffHours: number): boolean | null {
    const a = phutTrongNgayLamViec(moc, cutoffHours);
    const b = phutTrongNgayLamViec(bayGio, cutoffHours);
    if (a === null || b === null) return null;
    return b > a;
}
