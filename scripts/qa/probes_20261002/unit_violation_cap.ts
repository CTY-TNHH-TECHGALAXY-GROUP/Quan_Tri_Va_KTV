/** Graded violation cap shared by kiosk + WRB journey: 0→scale, 1→scale−1, 2→2, ≥3→1. */
import { maxRatingWithViolation } from '@/lib/services/RatingScaleService';
const cases: [4 | 5, number, number][] = [[4, 0, 4], [4, 1, 3], [4, 2, 2], [4, 3, 1], [4, 6, 1], [5, 0, 5], [5, 1, 4], [5, 2, 2], [5, 3, 1]];
let failed = 0;
for (const [scale, count, want] of cases) {
  const got = maxRatingWithViolation(scale, count);
  if (got !== want) failed++;
  console.log(`${got === want ? 'PASS' : 'FAIL'} thang ${scale}, ${count} góp ý → tối đa ${got}★ (cần ${want}★)`);
}
console.log(`${maxRatingWithViolation(5) === 4 ? 'PASS' : 'FAIL'} gọi kiểu cũ (không truyền số lỗi) = thang − 1`);
console.log(JSON.stringify({ failed }));
