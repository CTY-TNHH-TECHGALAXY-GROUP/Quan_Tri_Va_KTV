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

import { DEFAULT_RATING_LABELS, normalizeScale, ratingLabelFor, type RatingLabels } from '@/lib/services/RatingScaleService';

/** Nhãn nội bộ thang 4 (giữ cho chỗ cũ còn import). Nguồn thật: RatingScaleService + cấu hình `rating_labels`. */
export const RATING_LABELS: Record<number, string> = Object.fromEntries(
    Object.entries(DEFAULT_RATING_LABELS[4]).map(([level, set]) => [Number(level), set.internal]));

/**
 * Trả null khi chưa có đánh giá — nơi gọi tự quyết định hiện gì thay thế.
 * `scale` = thang của CHÍNH đánh giá đó (cột `rating_scale`, mặc định 4); mức vượt thang
 * (dữ liệu cũ 5 trên thang 4) đọc như mức cao nhất. `labels` = cấu hình admin nếu đã tải.
 */
export function ratingLabel(rating: number | null | undefined, scale?: unknown, labels?: RatingLabels): string | null {
    return ratingLabelFor(rating, normalizeScale(scale), labels);
}
