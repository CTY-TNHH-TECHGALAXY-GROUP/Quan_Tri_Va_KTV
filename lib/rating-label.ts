/**
 * ================================================================
 * TÊN GỌI CÁC MỨC ĐÁNH GIÁ — dùng chung app KTV và quầy
 * ================================================================
 * Cùng một mức sao thì mọi màn phải gọi ra đúng một chữ. Trước đây Lịch Sử ghi
 * "Tốt" còn ví ghi "3★" — hai màn nói về cùng một thứ bằng hai kiểu, KTV đối
 * chiếu không ra.
 *
 * Tỉ lệ trừ tiền theo mức KHÔNG nằm ở đây: nó là cấu hình động
 * (`ktv_type_d_rating_deduction` trong SystemConfigs), quản lý đổi được.
 */

/** Mức 5 là dữ liệu cũ — thang hiện tại chỉ tới 4. Vẫn đọc ra "Xuất sắc". */
export const RATING_LABELS: Record<number, string> = {
    1: 'Tệ',
    2: 'Bình thường',
    3: 'Tốt',
    4: 'Xuất sắc',
    5: 'Xuất sắc',
};

/** Trả null khi chưa có đánh giá — nơi gọi tự quyết định hiện gì thay thế. */
export function ratingLabel(rating: number | null | undefined): string | null {
    const n = Number(rating);
    return n > 0 ? (RATING_LABELS[n] ?? null) : null;
}
