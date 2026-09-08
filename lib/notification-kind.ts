/**
 * ================================================================
 * PHÂN LOẠI THÔNG BÁO — nguồn duy nhất
 * ================================================================
 * `StaffNotifications.type` là chuỗi tự do, mỗi nơi trong code đặt một kiểu
 * (`WARNING`, `AUTO_LOCK_ABSENCE`, `SUDDEN_OFF_WARNING`…). Màn hình nào cũng tự
 * viết một chuỗi if/else để đoán xem nên hiện icon và màu gì, và chuỗi nào cũng
 * bỏ sót:
 *
 *  - Toast của KTV từng để MỌI loại không khớp rơi về "Phần thưởng mới" + sao xanh,
 *    nên phiếu TRỪ điểm Office hiện lên y như một phần thưởng.
 *  - Danh sách trong chuông chỉ biết REWARD và DISCIPLINE, nên tin KHOÁ TÀI KHOẢN
 *    hiện thành bong bóng chat xanh như một lời nhắn bình thường.
 *
 * Nay mọi nơi hỏi cùng một hàm. Thêm loại mới thì khai báo ở đây một lần, các màn
 * hình tự khớp. Loại chưa khai báo rơi về `info` — trung tính, không mượn giao
 * diện của nhóm khác.
 */

export type NotificationKind =
    | 'complaint'   // khách phàn nàn — khẩn
    | 'lock'        // khoá tài khoản
    | 'penalty'     // trừ điểm, trừ giờ, nhắc nhở kỷ luật
    | 'reward'      // thưởng, tip, hoa hồng
    | 'success'     // tin tốt không phải tiền: hoàn điểm, mở khoá
    | 'order'       // đơn mới
    | 'checkin'     // điểm danh
    | 'shift'       // ca làm
    | 'leave'       // nghỉ phép
    | 'wallet'      // ví
    | 'reception'   // phản hồi từ quầy
    | 'info';       // mặc định

const BY_TYPE: Record<string, NotificationKind> = {
    COMPLAINT: 'complaint',

    ACCOUNT_LOCK: 'lock',
    AUTO_LOCK_ABSENCE: 'lock',
    AUTO_LOCK_REJECT_NO_HOURS: 'lock',
    AUTO_LOCK_NO_REGISTRATION: 'lock',

    WARNING: 'penalty',
    PENALTY: 'penalty',
    DISCIPLINE: 'penalty',
    SUDDEN_OFF_WARNING: 'penalty',
    EXTENSION_WARNING: 'penalty',
    ORDER_REJECT: 'penalty',
    KTV_REJECT_ORDER: 'penalty',
    OFFICE_SCORE_DEDUCT: 'penalty',
    HANDOVER_REJECTED: 'penalty',
    REACTIVATION_FEE: 'penalty',
    INVALID_WIFI_IP: 'penalty',
    INVALID_LOGIN: 'penalty',

    REWARD: 'reward',
    REWARD_APPROVED: 'reward',
    BONUS: 'reward',
    EARN: 'reward',
    TIP: 'reward',
    COMMISSION: 'reward',

    SUCCESS: 'success',
    MANUAL_UNLOCK: 'success',
    OFFICE_SCORE_REVOKE: 'success',

    KTV_NEW_ORDER: 'order',

    CHECK_IN: 'checkin',
    ATTENDANCE: 'checkin',
    ATTENDANCE_REQUEST: 'checkin',
    ATTENDANCE_RESPONSE: 'checkin',

    SHIFT_RESPONSE: 'shift',
    KTV_ON_CALL: 'shift',
    KTV_OFF_CALL: 'shift',
    LEAVE_RESPONSE: 'leave',
    WALLET: 'wallet',
    REQUEST_CONFIRMED: 'reception',
};

/** Tiêu đề hiển thị cho từng nhóm. */
export const NOTIFICATION_TITLE: Record<NotificationKind, string> = {
    complaint: 'Thông báo khẩn',
    lock: 'Khoá tài khoản',
    penalty: 'Nhắc nhở kỷ luật',
    reward: 'Phần thưởng mới',
    success: 'Đã xử lý',
    order: 'Đơn hàng mới',
    checkin: 'Điểm danh',
    shift: 'Thông báo ca',
    leave: 'Kết quả nghỉ phép',
    wallet: 'Thông báo ví',
    reception: 'Phản hồi từ Quầy',
    info: 'Thông báo',
};

/**
 * Những loại tin KHÔNG được phát ra tiếng.
 *
 * KTV phần lớn thời gian đang ở trong phòng với khách, nên chuông chỉ dành cho
 * việc cần phản ứng ngay (đơn mới, có khách, khẩn cấp). Mấy tin xác nhận kiểu
 * "Quầy đã xử lý: OK Em" thì hiện lên là đủ — kêu lên giữa lúc đang làm là bất
 * tiện cho cả KTV lẫn khách.
 *
 * Vẫn hiện toast và vẫn vào lịch sử bình thường, chỉ tắt tiếng và tắt rung.
 */
const SILENT_TYPES = new Set<string>([
    'REQUEST_CONFIRMED',   // quầy phản hồi yêu cầu nước/hỗ trợ/mua thêm
    'ATTENDANCE_RESPONSE', // xác nhận điểm danh / tan ca
    'KTV_OFF_CALL',        // KTV tắt nhận đơn — tin nền cho quầy
    'SYSTEM_LOG',
]);

export function isSilentNotification(rawType?: string | null): boolean {
    if (!rawType) return false;
    return SILENT_TYPES.has(String(rawType).toUpperCase());
}

export function notificationKind(rawType?: string | null): NotificationKind {
    if (!rawType) return 'info';
    return BY_TYPE[String(rawType).toUpperCase()] || 'info';
}
