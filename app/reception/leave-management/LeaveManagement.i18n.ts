/**
 * Text dictionary for Admin Leave & Shift Management page.
 */
export const t = {
    pageTitle: 'Quản Lý Lịch OFF & Ca',
    pageSubtitle: 'Xem và duyệt yêu cầu nghỉ phép, quản lý ca làm việc nhân viên.',
    noAccess: 'Không có quyền truy cập',

    // Tabs
    tabOff: 'Duyệt OFF',
    tabShift: 'Quản Lý Ca',

    // Stats
    statTotal: 'Tổng',
    statPending: 'Chờ duyệt',
    statApproved: 'Đã duyệt',
    statRejected: 'Từ chối',

    // Pending section
    pendingTitle: 'Yêu Cầu Chờ Duyệt',
    pendingEmpty: 'Không có yêu cầu nào đang chờ duyệt.',

    // History section
    historyTitle: 'Lịch OFF Đã Xử Lý',
    historyEmpty: 'Chưa có lịch OFF nào.',

    // Actions
    approve: 'Duyệt',
    reject: 'Từ chối',
    delete: 'Xoá',
    deleteConfirm: 'Bạn chắc chắn muốn xoá yêu cầu này?',

    // Status
    statusPending: 'Chờ duyệt',
    statusApproved: 'Đã duyệt',
    statusRejected: 'Từ chối',

    // Filter
    filterAll: 'Tất cả',
    filterMonth: 'Tháng',

    // Loading
    loading: 'Đang tải dữ liệu...',

    // ── Shift Management ──
    shiftOverviewTitle: 'Ca Làm Hiện Tại',
    shiftOverviewEmpty: 'Chưa có nhân viên nào được gán ca.',
    shiftPendingTitle: 'Yêu Cầu Đổi Ca',
    shiftPendingEmpty: 'Không có yêu cầu đổi ca nào.',
    shiftAssign: 'Gán Ca',
    shiftAssignTitle: 'Gán Ca Cho Nhân Viên',
    shiftNoAssignment: 'Chưa gán',
    shiftChange: 'Đổi ca',

    // Shift labels
    SHIFT_1: 'Ca 1 (09:00 - 17:00)',
    SHIFT_2: 'Ca 2 (11:00 - 19:00)',
    SHIFT_3: 'Ca 3 (17:00 - 00:00)',
    FREE: 'Ca tự do',
    REQUEST: 'Làm khách yêu cầu',
} as const;
