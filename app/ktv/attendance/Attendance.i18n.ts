/**
 * Text dictionary for KTV Attendance page.
 */
export const t = {
    pageTitle: 'Chấm Công',
    pageSubtitle: 'Bấm nút để ghi nhận vị trí và thông báo quản lý.',
    loadingStatus: 'Đang kiểm tra trạng thái...',
    noAccess: 'Không có quyền truy cập',

    // IDLE
    startShift: 'Bắt đầu ca làm việc',
    wifiNote: 'Hệ thống sẽ ghi nhận IP mạng Wi-Fi của bạn',
    checkIn: 'ĐIỂM DANH',

    // Loading
    loadingNetwork: 'Đang xác thực mạng...',

    // Pending
    pendingTitle: 'Đang xử lý',
    pendingDesc: 'Hệ thống đang ghi nhận yêu cầu của bạn',
    sentAt: (time: string) => `Gửi lúc: ${time}`,

    // Confirmed
    confirmedTitle: '✅ Đã điểm danh',
    confirmedDesc: 'Điểm danh của bạn đã được ghi nhận',
    shiftStart: (time: string) => `Vào ca: ${time}`,
    checkOut: 'TAN CA',
    checkOutPhotoOptional: 'Chụp ảnh (tùy chọn)',
    cannotCheckOutYet: (time: string) => `Lưu ý: Chưa tới giờ tan ca chuẩn (${time})`,
    noShiftAssigned: 'Bạn chưa được gán ca — vui lòng liên hệ quản lý.',

    // Late / Warning string
    lateWarning: '⚠️ Bạn đang điểm danh trễ — vui lòng nhập lý do',
    reasonRequired: 'Lý do điểm danh trễ (*)',
    reasonPlaceholder: 'Ví dụ: Kẹt xe, do lý do cá nhân...',
    reasonOptional: 'Lý do/Ghi chú (tùy chọn)',
    reasonRequiredGeneral: 'Lý do/Ghi chú (*)',

    // Photo
    addPhoto: (count: number, max: number) => `Thêm ảnh (${count}/${max})`,
    openCamera: 'Mở Camera Điện Thoại',
    photoRequired: 'Chụp ảnh minh chứng (*)',

    // Rejected
    rejectedTitle: '❌ Admin đã từ chối',
    rejectedDesc: 'Vui lòng liên hệ quản lý để được hỗ trợ',
    retry: 'Thử lại',

    // Checked out
    checkedOutTitle: 'Đã tan ca',
    checkedOutDesc: 'Cảm ơn bạn đã làm việc hôm nay!',
} as const;
