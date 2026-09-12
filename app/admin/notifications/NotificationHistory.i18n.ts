/**
 * Text dictionary for Notification History page.
 * Centralizes all UI text content for easy maintenance and future i18n support.
 */
export const t = {
    // Page Header
    pageTitle: 'Lịch sử Thông báo',
    pageSubtitle: 'Theo dõi và xử lý các yêu cầu từ nhân viên và khách hàng',

    // Actions
    refresh: 'Làm mới',
    clearDate: 'Xoá ngày',

    // Filter tabs
    filterAll: 'Tất cả',
    filterPending: 'Chưa xử lý',
    filterCompleted: 'Đã xong',

    // Search
    searchPlaceholder: 'Tìm kiếm nội dung thông báo...',

    // Stats
    statsPendingLabel: 'Cần xử lý',

    // List
    listTitle: 'Danh sách yêu cầu',
    pageLabel: (page: number) => `TRANG ${page}`,
    
    // Empty & Loading states
    loading: 'Đang tải dữ liệu...',
    emptyTitle: 'Không có thông báo nào',
    emptySubtitle: 'Thử thay đổi bộ lọc hoặc ngày xem sao',

    // Notification row
    goToDispatch: 'Đi tới Điều phối',
} as const;
