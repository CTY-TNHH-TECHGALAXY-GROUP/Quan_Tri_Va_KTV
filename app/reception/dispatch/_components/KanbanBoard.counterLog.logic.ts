/**
 * Nhật ký "Thao tác" trên thẻ Kanban — dựng danh sách dòng để hiện.
 *
 * Hai nguồn:
 *   1. `BookingItems.options.counterLog[]` (lib/counter-action-log.ts) — quầy bấm
 *      gì, và từ 14/09/2026 cả hai nút KTV bấm trên app.
 *   2. `StaffNotifications` (type EARLY_EXIT / EMERGENCY) — nơi DUY NHẤT còn giữ
 *      KTV đã bấm nút gì với đơn trước 14/09/2026; với đơn mới là lưới an toàn
 *      vì `logKtvReport` cố ý không throw, lỗi là mất dòng trong im lặng.
 *
 * Tách khỏi KanbanBoard.tsx để chạy được bằng Node trên dữ liệu thật.
 */

/** Nhãn tiếng Việt cho nhật ký thao tác quầy (lib/counter-action-log.ts). */
export const ACTION_LABEL: Record<string, string> = {
    PAUSE: 'Tạm dừng',
    RESUME: 'Tiếp tục',
    FINISH_EARLY: 'Kết thúc sớm',
    CANCEL: 'Huỷ',
    SWAP_KTV: 'Đổi KTV',
    SWAP_SEND: 'Gửi người mới',
    KTV_EARLY_EXIT: 'Khách về sớm',
    KTV_EMERGENCY: 'Khẩn cấp',
};

export const UNKNOWN_ACTOR_LABEL = 'không ghi được người bấm';
export const OFFICE_ACTOR_LABEL = 'tài khoản văn phòng';
export const UNVERIFIED_ACTOR_TITLE = 'Phiên đăng nhập máy chủ đã hết — tên lấy theo tài khoản đang mở trên tab';

// 🔧 UI CONFIGURATION
/** A KTV pause within this window of their own report is shown as the report only. */
export const KTV_REPORT_MERGE_WINDOW_MS = 120_000;
/** Same report by the same KTV within this window is a double tap (real data: ≤ 13s). */
export const KTV_REPORT_REPEAT_WINDOW_MS = 30_000;
const KTV_REPORT_ACTIONS = new Set(['KTV_EARLY_EXIT', 'KTV_EMERGENCY']);

/**
 * Báo sự cố phòng (giường hỏng, toilet nghẹt) dùng chung type EMERGENCY nhưng
 * KHÔNG dừng đơn — phân biệt bằng đầu chuỗi tin nhắn, xem `handleReportRoomIssue`
 * trong app/ktv/dashboard/KTVDashboard.logic.ts.
 */
const ROOM_ISSUE_MESSAGE_PREFIX = '🚩';

export interface KtvReportRow {
    type: string;
    employeeId: string | null;
    createdAt: string;
    message?: string | null;
}

/** Nút KTV đã bấm, hoặc null nếu thông báo này không phải nút dừng đơn. */
export const reportActionOf = (r: KtvReportRow): 'KTV_EARLY_EXIT' | 'KTV_EMERGENCY' | null => {
    if (r?.type === 'EARLY_EXIT') return 'KTV_EARLY_EXIT';
    if (r?.type === 'EMERGENCY' && !String(r.message || '').startsWith(ROOM_ISSUE_MESSAGE_PREFIX)) return 'KTV_EMERGENCY';
    return null;
};

const timeOf = (e: any) => new Date(e?.at).getTime() || 0;
const sameActor = (a: any, b: any) => String(a?.by || '').toUpperCase() === String(b?.by || '').toUpperCase();

/**
 * Pressing "Khách về sớm" / "Khẩn cấp" on the app writes two entries: the pause
 * and the report. Show one line — "T007 Khách về sớm" — by hiding that KTV's own
 * pause next to the report, and collapse repeated taps.
 *
 * ⚠️ Only a pause whose `by` IS the reporting KTV is hidden. Before 14/09/2026 a
 * pause with no actor was hidden too, which swallowed the counter's own pause
 * (session lost → `by = null`) whenever it fell within 2 minutes of a report.
 */
export const mergeKtvReports = (log: any[]): any[] => {
    const reports = log.filter(e => KTV_REPORT_ACTIONS.has(e?.action));
    if (reports.length === 0) return log;

    return log.filter((e, idx) => {
        if (e?.action === 'PAUSE') {
            return !e.by || !reports.some(r =>
                sameActor(e, r) && Math.abs(timeOf(r) - timeOf(e)) <= KTV_REPORT_MERGE_WINDOW_MS);
        }
        if (KTV_REPORT_ACTIONS.has(e?.action)) {
            return !log.slice(0, idx).some(p =>
                p?.action === e.action && sameActor(p, e) && timeOf(e) - timeOf(p) <= KTV_REPORT_REPEAT_WINDOW_MS);
        }
        return true;
    });
};

/**
 * Gộp nhật ký của mọi dịch vụ trên thẻ với các lần KTV bấm nút trên app.
 *
 * @param ktvOnCard  mã KTV có mặt trên thẻ, chữ thường. Một booking tách nhiều thẻ
 *                   (mỗi khách một thẻ) thì báo của KTV thẻ bên kia không lọt sang.
 *
 * ⚠️ Sắp theo MỐC THỜI GIAN đã parse, đừng so chuỗi: `...Z` và `...+00:00` là
 * cùng một thời điểm nhưng so chuỗi ra khác nhau.
 */
export const buildCounterLog = (services: any[], ktvReports: KtvReportRow[] | undefined, ktvOnCard: Set<string>): any[] => {
    const fromItems = (services || [])
        .flatMap((s: any) => Array.isArray(s?.options?.counterLog) ? s.options.counterLog : []);

    const fromReports = (ktvReports || [])
        .filter(r => r?.employeeId && ktvOnCard.has(String(r.employeeId).toLowerCase()))
        .map(r => {
            const action = reportActionOf(r);
            return action ? { action, by: r.employeeId, byName: r.employeeId, at: r.createdAt } : null;
        })
        .filter(Boolean);

    // Cùng một lần bấm có thể có ở cả hai nguồn (cùng nút, cùng người, cách nhau
    // vài mili giây) — luật "bấm lặp ≤ 30 giây" của mergeKtvReports giữ lại một.
    const all = [...fromItems, ...fromReports].sort((a: any, b: any) => timeOf(a) - timeOf(b));
    return mergeKtvReports(all);
};

/**
 * Tên người bấm để HIỂN THỊ, hoặc null khi không ghi được ai.
 *
 * ⚠️ `by` của tài khoản văn phòng là id kỹ thuật — cuid ('cmlxhhysl0000…') hoặc
 * uuid ('8de3f0a8-1783-…'), dài và vô nghĩa với quầy. Chỉ đổ `by` ra màn hình
 * khi nó là MÃ NHÂN VIÊN thật (T007, NH025…), tức chuỗi ngắn không có dấu gạch.
 */
export const counterActorName = (entry: any): string | null => {
    if (entry?.byName) return String(entry.byName);
    const by = entry?.by ? String(entry.by) : '';
    if (by && by.length <= 12 && !by.includes('-')) return by;
    return by ? OFFICE_ACTOR_LABEL : null;
};

/**
 * Một dòng đã dựng sẵn chữ, theo thứ tự: người · việc · ghi chú · (suffix).
 *   "T069 Khẩn cấp" / "admin* Kết thúc sớm chốt tại mốc tạm dừng"
 *   / "Kết thúc sớm chốt tại mốc tạm dừng · không ghi được người bấm"
 */
export const counterLogLine = (entry: any): {
    actor: string | null; label: string; note: string | null; suffix: string | null; unverified: boolean;
} => {
    const actor = counterActorName(entry);
    return {
        actor,
        label: ACTION_LABEL[entry?.action] || String(entry?.action || ''),
        note: entry?.note ? String(entry.note) : null,
        suffix: actor ? null : UNKNOWN_ACTOR_LABEL,
        unverified: entry?.verified === false,
    };
};
