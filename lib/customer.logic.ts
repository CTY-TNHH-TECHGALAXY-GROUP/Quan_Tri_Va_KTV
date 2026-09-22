// =============================================
// 🔧 SHARED CONSTANTS — Single Source of Truth
// Sửa ở đây = áp dụng toàn hệ thống
// =============================================

/** Statuses that count as "completed" visits for visit counting */
export const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'FEEDBACK', 'CLEANING'];

/** Threshold: visits must be GREATER than this to be "Khách Cũ" (>= 1 đơn hoàn tất trong quá khứ -> tổng >= 2 lần) */
export const RETURNING_THRESHOLD = 0;

// =============================================
// 🛠 SHARED UTILITIES — Import & dùng lại ở mọi nơi
// =============================================

/** Check if a phone number is a dummy/placeholder value (rỗng hoặc toàn số 0) */
export const isDummyPhone = (p: string): boolean => !p || /^0+$/.test(p.trim());

/**
 * Domain của email ảo do hệ thống tự sinh cho khách vãng lai không có email thật.
 * Giữ ở một chỗ để hàm nhận diện và hàm sinh không bao giờ lệch nhau.
 */
const GUEST_EMAIL_DOMAIN = '@guest.com';

/** Sinh email ảo cho khách không có email thật (đảm bảo không trùng). */
export const makeGuestEmail = (): string =>
  `guest${Date.now()}_${Math.floor(Math.random() * 1000)}${GUEST_EMAIL_DOMAIN}`;

/**
 * Email ảo/placeholder: rỗng, không chứa '@', hoặc là địa chỉ do makeGuestEmail sinh ra.
 *
 * Cố ý dùng endsWith chứ KHÔNG dùng includes('@guest'): includes bắt nhầm email thật
 * ở các domain như booking@guesthouse.com hay info@guest-services.vn, khiến khách
 * bị ghi đè mất email thật và không nhận được email xác nhận.
 * Có trim + toLowerCase vì địa chỉ nhập tay có thể viết hoa (X@GUEST.COM).
 */
export const isDummyEmail = (e: string): boolean => {
  const v = (e || '').trim().toLowerCase();
  return !v || !v.includes('@') || v.endsWith(GUEST_EMAIL_DOMAIN);
};

/** Check if visit count qualifies as returning customer */
export const isReturningCustomer = (visitCount: number): boolean => visitCount > RETURNING_THRESHOLD;

/**
 * Fuzzy name matching — đồng bộ với CRM (route.ts line 112-117)
 * Manager thường tái sử dụng 1 tài khoản GUEST cho nhiều khách khác nhau,
 * nên cần verify tên khớp trước khi đếm lượt ghé.
 */
export const isNameMatch = (name1: string, name2: string): boolean => {
  const n1 = (name1 || '').toLowerCase().trim();
  const n2 = (name2 || '').toLowerCase().trim();
  return !n1 || !n2 || n1 === n2 || n1.includes(n2) || n2.includes(n1);
};
