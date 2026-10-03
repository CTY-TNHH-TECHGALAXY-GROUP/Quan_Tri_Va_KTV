/**
 * Khách đã tích ít nhất một lỗi thì điểm cao nhất chỉ còn 3 sao.
 *
 * 4 sao nghĩa là "không có gì để phàn nàn", mà bảng trừ đang để 4 sao = trừ 0%
 * (`ktv_type_d_rating_deduction`). Nếu để khách vừa tích lỗi vừa chấm 4 sao thì
 * KTV vẫn nhận đủ 100% tiền và cái lỗi kia thành vô nghĩa.
 *
 * ⚠️ Trần này phải chặn ở CẢ HAI tầng:
 *   - giao diện (KioskFeedbackModal) ẩn nút 4 sao đi cho khách khỏi bấm nhầm
 *   - server (submitFeedbackAction) kẹp lại lần nữa, vì đó mới là chỗ ghi vào
 *     `Bookings.rating` / `itemRating` / `ktvRatings` — chỗ quyết định tiền.
 *
 * Để riêng file này vì `actions.ts` mang 'use server', mà module 'use server'
 * chỉ được phép export hàm async — export hằng số ở đó là vỡ build.
 */
export const MAX_RATING_WITH_VIOLATION = 3;
