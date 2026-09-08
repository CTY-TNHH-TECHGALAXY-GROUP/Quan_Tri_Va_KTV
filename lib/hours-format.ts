/**
 * ================================================================
 * ĐỊNH DẠNG GIỜ TÍCH LUỸ — dùng chung Office và app KTV
 * ================================================================
 * Hai màn hình cùng nói về một con số thì phải đọc ra một chuỗi giống hệt nhau.
 * Trước đây mỗi nơi tự viết một hàm `fmtHours`, chênh nhau ở chỗ làm tròn phút là
 * đủ để KTV thấy "18h 30P" bên này, "18h 29P" bên kia rồi đi hỏi quầy.
 */

/** Giờ thập phân → "18h 30P". Cùng định dạng với bảng điều phối. */
export function fmtHours(h: number): string {
    const total = Number(h) || 0;
    const sign = total < 0 ? '−' : '';
    const abs = Math.abs(total);
    const hh = Math.floor(abs);
    const mm = Math.round((abs - hh) * 60);
    // Làm tròn phút có thể đẩy lên 60 (vd 2.999h) — dồn lên giờ cho khỏi hiện "2h 60P".
    if (mm === 60) return `${sign}${hh + 1}h 00P`;
    return `${sign}${hh}h ${String(mm).padStart(2, '0')}P`;
}

/** 'YYYY-MM-DD' → '03/09'. */
export function fmtShortDate(iso: string | null): string {
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return m && d ? `${d}/${m}` : iso;
}

/** 'YYYY-MM-DD' → 'Thứ 7' / 'Chủ nhật'. */
export function fmtWeekday(iso: string): string {
    const [y, m, d] = String(iso ?? '').split('-').map(Number);
    if (!y || !m || !d) return '';
    // Dựng theo UTC để khỏi bị lệch một ngày do múi giờ của máy chạy.
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][wd];
}

/** 'YYYY-MM-DD' → '05/09/2026'. */
export function fmtFullDate(iso: string): string {
    const [y, m, d] = String(iso ?? '').split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(iso ?? '');
}

/**
 * Mốc thời gian trong sổ → 'HH:mm' giờ VN.
 *
 * Cột giờ trong DB khi thì có múi (timestamptz của phiếu phạt), khi thì trần theo
 * UTC (booking_time_start). Chuỗi trần mà đưa thẳng vào `new Date()` sẽ bị hiểu là
 * giờ ĐỊA PHƯƠNG — lệch 7 tiếng. Phải gắn 'Z' trước, giống parseDbDate.
 */
export function fmtClock(at: string | null | undefined): string {
    if (!at) return '';
    const raw = String(at);
    const hasZone = raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw);
    const d = new Date(hasZone ? raw : raw + 'Z');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

/** 'YYYY-MM' dịch đi `delta` tháng. */
export function shiftMonth(monthStr: string, delta: number): string {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' của tháng hiện tại theo giờ VN. */
export function currentMonthVn(): string {
    const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}
