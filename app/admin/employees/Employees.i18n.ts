/**
 * Text dictionary for Employee Management page.
 */
export const t = {
    // Page
    pageTitle: 'Nhân Viên',
    pageSubtitle: 'Quản lý hồ sơ, kỹ năng và thông tin chi tiết của kỹ thuật viên.',

    // Permission
    noAccess: 'Không có quyền truy cập',
    noAccessDetail: 'Bạn cần quyền "Quản Lý KTV" để xem trang này.',

    // Actions
    addNew: 'Thêm KTV Mới',
    advancedFilter: 'Bộ lọc nâng cao',
    deleteEmployee: 'Xoá nhân viên',

    // Search
    searchPlaceholder: 'Tìm theo tên, mã, số điện thoại...',

    // Table headers
    thEmployee: 'Nhân Viên',
    thPosition: 'Chức Vụ',
    thStatus: 'Trạng Thái',
    thSkills: 'Kỹ Năng Chính',
    thRating: 'Đánh Giá',

    // Status
    statusActive: 'Đang làm việc',
    statusInactive: 'Đã nghỉ',

    // Skills
    skillShampoo: 'Gội đầu',
    skillOilBody: 'Body Dầu',
    skillFacial: 'Facial',
    skillBodyMix: 'Body Mix',

    // Loading / Empty
    loading: 'Đang tải dữ liệu nhân viên...',
    empty: 'Chưa có dữ liệu nhân viên.',

    // Stats
    statsTotal: 'Tổng số KTV',
    statsActive: 'Đang hoạt động',
    statsSenior: 'KTV Cấp Cao',
    statsAvgRating: 'Đánh giá TB',

    // Experience suffix
    experienceSuffix: 'kinh nghiệm',
} as const;
