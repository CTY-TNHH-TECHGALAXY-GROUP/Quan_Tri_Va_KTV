/**
 * Text dictionary for KTV Schedule page (OFF + Shift).
 */
export const t = {
    pageTitle: 'Lịch Làm Việc',
    pageSubtitle: 'Quản lý ca làm và đăng ký ngày nghỉ.',
    noAccess: 'Không có quyền truy cập',

    // Tabs
    tabOff: 'Đăng Ký OFF',
    tabShift: 'Ca Làm Việc',

    // ── OFF Tab ──
    offFormTitle: 'Đăng Ký OFF',
    labelDate: 'Ngày nghỉ',
    labelReason: 'Lý do nghỉ',
    placeholderReason: 'Nhập lý do chi tiết...',
    warning: 'Nếu số ngày OFF trong tháng vượt quá 4 ngày, bạn sẽ không đủ điều kiện xét duyệt Bonus tháng.',
    warningPrefix: 'Lưu ý:',
    deadlineWarning: 'Phải đăng ký trước 19h ngày hôm trước.',
    submit: 'Gửi Yêu Cầu OFF',
    submitting: 'Đang gửi...',
    submitSuccess: '✅ Đã gửi yêu cầu OFF thành công!',

    // OFF schedule list
    scheduleTitle: 'Lịch OFF Nhân Viên',
    scheduleSubtitle: '30 ngày tới',
    scheduleEmpty: 'Chưa có ai đăng ký OFF.',
    scheduleLoading: 'Đang tải lịch OFF...',

    // OFF Status badges
    statusPending: 'Chờ duyệt',
    statusApproved: 'Đã duyệt',
    statusRejected: 'Từ chối',

    // ── Shift Tab ──
    shiftCurrentTitle: 'Ca Hiện Tại',
    shiftCurrent: 'Ca Hiện Tại',
    shiftCurrentEmpty: 'Chưa có ca',
    shiftNoShift: 'Chưa được gán ca. Liên hệ Admin.',
    shiftFormTitle: 'Yêu Cầu Đổi Ca',
    shiftChangeTitle: 'Yêu Cầu Đổi Ca',
    shiftSelectNew: 'Chọn ca mới',
    shiftReason: 'Lý do đổi ca',
    shiftReasonPlaceholder: 'Nhập lý do muốn đổi ca...',
    shiftSubmit: 'Gửi Yêu Cầu Đổi Ca',
    shiftSubmitting: 'Đang gửi...',
    shiftSubmitSuccess: '✅ Đã gửi yêu cầu đổi ca!',
    shiftPendingTitle: 'Yêu cầu chờ duyệt',
    shiftRequestFrom: 'Từ',
    shiftRequestTo: 'Sang',
    shiftPendingNote: '⏳ Bạn đang có yêu cầu đổi ca chờ duyệt.',
    shiftHistoryTitle: 'Lịch Sử Đổi Ca',
    shiftHistoryEmpty: 'Chưa có lịch sử đổi ca.',
    shiftLoading: 'Đang tải thông tin ca...',

    // Shift labels
    SHIFT_1: 'Ca 1 (09:00 - 17:00)',
    SHIFT_2: 'Ca 2 (11:00 - 19:00)',
    SHIFT_3: 'Ca 3 (17:00 - 00:00)',
} as const;
