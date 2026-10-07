/** Unit RatingScaleService: thang 4 phải y hệt hành vi trước GĐ1; thang 5 theo quyết định 02/10/2026. */
import { buildRatingConfig, deductionRate, isTopRating, qualifiesForBonus, maxRatingWithViolation, clampRating, ratingLabelFor, normalizeScale } from '@/lib/services/RatingScaleService';
import { ratingLabel } from '@/lib/rating-label';
let fail = 0; const ok = (n: string, c: boolean, d: any = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`); };
const OLD = { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 } as Record<string, number>;
const oldRate = (r: number) => OLD[String(r)] ?? 0;            // công thức cũ: map[String(rating)] ?? 0
const cfg = buildRatingConfig({});
for (const r of [0, 1, 2, 3, 4, 5]) ok(`thang 4: ${r}★ trừ như cũ (${oldRate(r)})`, deductionRate(cfg.typeD[4], r) === oldRate(r), deductionRate(cfg.typeD[4], r));
ok('thang 5 Loại D mặc định 5★0 4★0 3★25 2★50 1★75', [5, 4, 3, 2, 1].map(r => deductionRate(cfg.typeD[5], r)).join() === '0,0,0.25,0.5,0.75');
ok('A/B/C mặc định 0% ở cả 2 thang', [1, 2, 3, 4, 5].every(r => deductionRate(cfg.abc[4], r) === 0 && deductionRate(cfg.abc[5], r) === 0));
ok('thưởng thang 4: chỉ 4★ (như cũ ≥4), dữ liệu cũ 5 vẫn thưởng', !qualifiesForBonus(3, 4) && qualifiesForBonus(4, 4) && qualifiesForBonus(5, 4));
ok('thưởng thang 5: chỉ 5★', !qualifiesForBonus(4, 5) && qualifiesForBonus(5, 5));
ok('Xuất sắc = mức cao nhất của thang', isTopRating(4, 4) && !isTopRating(4, 5) && isTopRating(5, 5));
ok('có góp ý: tối đa thang−1', maxRatingWithViolation(4) === 3 && maxRatingWithViolation(5) === 4);
ok('chặn khoảng 1..thang', clampRating(7, 4) === 4 && clampRating(5, 5) === 5 && clampRating(0, 5) === null && clampRating('x', 4) === null);
ok('nhãn nội bộ thang 4 như cũ', [1, 2, 3, 4, 5].map(r => ratingLabel(r)).join('|') === 'Tệ|Bình thường|Tốt|Xuất sắc|Xuất sắc', [1, 2, 3, 4, 5].map(r => ratingLabel(r)));
ok('nhãn thang 5 theo bảng Oria (VN)', [1, 2, 3, 4, 5].map(r => ratingLabelFor(r, 5)).join('|') === 'Cực kỳ tệ|Thất vọng|Chưa ổn lắm|Tuyệt vời|Xuất sắc', [1, 2, 3, 4, 5].map(r => ratingLabelFor(r, 5)));
ok('nhãn thang 5 theo bảng Oria (EN/KR/JP/ZH mức 3)', ['EN', 'KR', 'JP', 'ZH'].map(l => ratingLabelFor(3, 5, cfg.labels, l as any)).join('|') === 'Could be better|아쉬움|もう少し|有待改进');
ok('nhãn kiosk EN thang 4 mức 4 = Excellent', ratingLabelFor(4, 4, cfg.labels, 'EN') === 'Excellent');
const custom = buildRatingConfig({ customer_rating_scale: 5, ktv_abc_rating_deduction_on: true, rating_labels: { 5: { 1: { internal: 'Rất tệ', VN: 'Rất tệ' } } }, ktv_abc_rating_deduction_5: { '1': 0.3, '2': 'x', '3': 2 } });
ok('admin đổi nhãn 1★ thang 5 (ngôn ngữ khác giữ mặc định)', ratingLabelFor(1, 5, custom.labels) === 'Rất tệ' && ratingLabelFor(1, 5, custom.labels, 'EN') === 'Very poor');
ok('bảng A/B/C admin: nhận 0.3, bỏ giá trị hỏng', custom.abc[5]['1'] === 0.3 && custom.abc[5]['2'] === 0 && custom.abc[5]['3'] === 0);
const offD = buildRatingConfig({ ktv_type_d_rating_deduction_on: false });
ok('công tắc: Loại D mặc định BẬT (như trước), A/B/C mặc định TẮT', cfg.typeDOn === true && cfg.abcOn === false);
ok('công tắc tắt Loại D → mọi mức trừ 0%, bảng admin vẫn giữ', [1, 2, 3, 4].every(r => deductionRate(offD.typeD[4], r) === 0) && offD.typeDTables[4]['1'] === 0.75);
ok('A/B/C có bảng nhưng công tắc tắt → không trừ', deductionRate(buildRatingConfig({ ktv_abc_rating_deduction_5: { '1': 0.3 } }).abc[5], 1) === 0);
ok('scale config đọc được', custom.scale === 5 && normalizeScale(null) === 4 && normalizeScale('"5"') === 5);
ok('chưa đánh giá: không nhãn, không trừ', ratingLabel(0) === null && deductionRate(cfg.typeD[5], null) === 0);
console.log(JSON.stringify({ failed: fail })); if (fail) process.exitCode = 1;
