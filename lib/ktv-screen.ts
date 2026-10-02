/**
 * Lúc nào thì KHOÁ điều hướng của KTV.
 *
 * Đang trong một đơn thì không cho rời đi. Trước đây chỉ khoá ở màn đồng hồ
 * (`TIMER`), nên xong tua là menu mở lại ngay giữa chừng: KTV bấm sang trang
 * khác rồi quay lại, màn Bàn giao mất, phòng vẫn nợ.
 *
 * Nay khoá suốt từ lúc nhận đơn cho tới khi BÀN GIAO XONG:
 *   TIMER (đang làm) → REVIEW (đánh giá khách) → HANDOVER (dọn phòng)
 *
 * `REWARD` KHÔNG khoá — tới đó phòng đã bàn giao xong, việc còn lại chỉ là xem
 * tiền và chấm sao quầy, rời đi cũng không hỏng gì.
 *
 * Một nguồn duy nhất cho cả AppLayout (nút 3 gạch) lẫn Sidebar (từng mục menu),
 * để hai chỗ không bao giờ lệch nhau.
 */
export const SERVING_LOCKED_SCREENS = ['TIMER', 'REVIEW', 'HANDOVER'] as const;

export function isServingLockedScreen(screen?: string | null): boolean {
    return (SERVING_LOCKED_SCREENS as readonly string[]).includes(String(screen || '').toUpperCase());
}
