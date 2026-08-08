/**
 * Text dictionary for KTV Leave page.
 */
export const t = {
    pageTitle: 'Đăng Ký OFF',
    pageSubtitle: 'Gửi yêu cầu nghỉ phép trước 19h hàng ngày.',
    noAccess: 'Không có quyền truy cập',

    // Form
    labelDate: 'Ngày nghỉ',
    labelReason: 'Lý do nghỉ',
    placeholderReason: 'Nhập lý do chi tiết...',
    warning: 'Nếu số ngày OFF trong tháng vượt quá 4 ngày, bạn sẽ không đủ điều kiện xét duyệt Bonus tháng.',
    warningPrefix: 'Lưu ý:',
    submit: 'Gửi Yêu Cầu OFF',
    submitting: 'Đang gửi...',
    submitSuccess: '✅ Đã gửi yêu cầu OFF thành công!',

    // Schedule list
    scheduleTitle: 'Lịch OFF Nhân Viên',
    scheduleSubtitle: '30 ngày tới',
    scheduleEmpty: 'Chưa có ai đăng ký OFF.',
    scheduleLoading: 'Đang tải lịch OFF...',

    // Status badges
    statusPending: 'Chờ duyệt',
    statusApproved: 'Đã duyệt',
    statusRejected: 'Từ chối',
} as const;
