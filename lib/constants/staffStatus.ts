/**
 * Ba trạng thái hợp lệ của `Staff.status`.
 *
 * Trước đây cột này là text tự do, không ràng buộc. Màn Thêm nhân viên ghi
 * thẳng `formData.status` xuống DB nên lọt vào các giá trị tiếng Anh `active` /
 * `working` — chính là 4 tài khoản hệ thống (ADMIN, dev, Developer, Quản Trị
 * Viên mặc định).
 *
 * Chúng "vô tình chạy đúng": mọi danh sách vận hành đều lọc `= 'ĐANG LÀM'` nên
 * bốn dòng đó bị loại khỏi bảng lương, báo cáo KTV, danh sách quầy và cron ghi
 * sổ. Nhưng đó là may chứ không phải thiết kế — sửa status cho "đúng chính tả"
 * là lập tức đẩy ADMIN với dev vào bảng lương.
 *
 * `HỆ THỐNG` biến cái may đó thành luật: tài khoản đăng nhập được nhưng KHÔNG
 * phải nhân sự. Các bộ lọc `= 'ĐANG LÀM'` sẵn có vẫn loại nó ra như cũ, không
 * phải sửa gì thêm.
 */
export const STAFF_STATUS = {
    /** Nhân sự thật, đang đi làm — cái duy nhất được tính vào vận hành. */
    WORKING: 'ĐANG LÀM',
    /** Đã nghỉ việc. Bị ép đăng xuất, gỡ khỏi sổ tua. */
    RESIGNED: 'ĐÃ NGHỈ',
    /**
     * Khoá kỷ luật — cron điểm danh và luồng từ chối tua ghi giá trị này, còn
     * `api/admin/staff/unlock` mở lại. Vẫn là nhân sự, chỉ không vào được app.
     */
    LOCKED: 'KHÓA_TÀI_KHOẢN',
    /** Tài khoản hệ thống (admin, dev). Đăng nhập được, không tính lương. */
    SYSTEM: 'HỆ THỐNG',
} as const;

export type StaffStatus = typeof STAFF_STATUS[keyof typeof STAFF_STATUS];

export const ALL_STAFF_STATUSES: StaffStatus[] = [
    STAFF_STATUS.WORKING,
    STAFF_STATUS.RESIGNED,
    STAFF_STATUS.LOCKED,
    STAFF_STATUS.SYSTEM,
];

/** Tài khoản hệ thống — không phải nhân sự, đừng đưa vào danh sách vận hành. */
export function isSystemAccount(status: string | null | undefined): boolean {
    return String(status || '') === STAFF_STATUS.SYSTEM;
}

/**
 * Ép một giá trị bất kỳ về đúng ba trạng thái hợp lệ.
 *
 * Dùng ở MỌI đường ghi vào `Staff.status`, để giá trị lạ không lọt xuống DB
 * lần nữa. Biến thể cũ `active` / `working` được hiểu là đang đi làm.
 */
export function normalizeStaffStatus(raw: any): StaffStatus {
    const value = String(raw ?? '').trim();

    if ((ALL_STAFF_STATUSES as string[]).includes(value)) return value as StaffStatus;

    const lower = value.toLowerCase();
    if (lower === 'inactive' || lower === 'resigned') return STAFF_STATUS.RESIGNED;
    // Biến thể lạc: `TurnQueueBoard` từng ghi 'NGHỈ VIỆC' — cùng nghĩa đã nghỉ,
    // nhưng không nơi nào ĐỌC giá trị đó nên người bị ẩn mà không ai coi là nghỉ.
    if (value === 'NGHỈ VIỆC') return STAFF_STATUS.RESIGNED;

    // '', 'active', 'working' và mọi thứ khác -> đang đi làm (mặc định của cột).
    return STAFF_STATUS.WORKING;
}
