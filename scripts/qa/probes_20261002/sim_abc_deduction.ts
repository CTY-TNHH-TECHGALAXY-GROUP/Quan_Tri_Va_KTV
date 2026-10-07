/** Mô phỏng khấu trừ A/B/C theo sao (mục 10 + 4.3): cùng KTV, cùng đơn → phía KTV = phía quản lý. */
import { KtvCommissionService as K } from '@/lib/services/KtvCommissionService';
import { buildRatingConfig } from '@/lib/services/RatingScaleService';
let fail = 0; const ok = (n: string, c: boolean, d: any = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`); };
const comm = { TYPE_A: { milestones: { '60': 150000, '90': 220000 }, ratePer60: 150000 }, TYPE_B: { milestones: {}, ratePer60: 180000 }, TYPE_C: { milestones: {}, ratePer60: 100000 } } as any;
const seg = (ktv: string, min: number, extra: any = {}) => ({ id: 's-' + ktv, ktvId: ktv, duration: min, startTime: '10:00', endTime: '11:00', ...extra });
const item = (o: any) => ({ id: 'I1', serviceId: 'NHS0001', status: 'DONE', technicianCodes: ['A1'], segments: [seg('A1', 60)], ...o });
const zero = buildRatingConfig({}).abc;
const cfg = buildRatingConfig({ ktv_abc_rating_deduction_on: true, ktv_abc_rating_deduction_4: { '1': 0.5, '2': 0.3, '3': 0.1 }, ktv_abc_rating_deduction_5: { '1': 0.5, '2': 0.4, '3': 0.2, '4': 0.05 } }).abc;
// "KTV side" (wallet/history path) and "management side" (reports path) call the same helper with their own data shape.
const ktvSide = (it: any, b: any, tables: any, wt = 'TYPE_A') => K.applyAbcRatingDeduction(K.calcCommission(60, comm, wt, it.serviceId), it, b, 'A1', tables, wt);
const mgmtSide = (it: any, tables: any, wt = 'TYPE_A') => K.applyAbcRatingDeduction(K.calcCommission(60, comm, wt, it.serviceId), it, null, 'A1', tables, wt);
const cases: [string, any, number][] = [
  ['chưa đánh giá', item({}), 150000],
  ['3/4 (bảng 10%)', item({ itemRating: 3, rating_scale: 4 }), 135000],
  ['4/4 mức cao nhất', item({ itemRating: 4, rating_scale: 4 }), 150000],
  ['4/5 (bảng 5%)', item({ itemRating: 4, rating_scale: 5 }), 142500],
  ['5/5', item({ itemRating: 5, rating_scale: 5 }), 150000],
  ['sao riêng KTV 2/5 ưu tiên hơn itemRating 5', item({ itemRating: 5, ktvRatings: { A1: 2 }, rating_scale: 5 }), 90000],
  ['dữ liệu cũ 5 trên thang 4 → không trừ', item({ itemRating: 5, rating_scale: 4 }), 150000],
];
console.log('Trường hợp | phía KTV | phía quản lý | mong đợi');
for (const [name, it, want] of cases) {
  const a = ktvSide(it, { rating: 1, rating_scale: 4, BookingItems: [it] }, cfg), m = mgmtSide(it, cfg);
  console.log(`  ${name} | ${a} | ${m} | ${want}`);
  ok(`${name}: 2 phía khớp và đúng số`, a === m && a === want, { a, m, want });
}
ok('công tắc A/B/C tắt (mặc định) → y hệt hoa hồng cũ dù đã nhập bảng', cases.every(([, it]) => ktvSide(it, {}, buildRatingConfig({ ktv_abc_rating_deduction_4: { '3': 0.1 } }).abc) === K.calcCommission(60, comm, 'TYPE_A', it.serviceId)));
ok('bảng mặc định 0% → y hệt hoa hồng cũ (mọi mức)', cases.every(([, it]) => ktvSide(it, {}, zero) === K.calcCommission(60, comm, 'TYPE_A', it.serviceId)));
ok('Loại D không bao giờ bị áp bảng A/B/C', ktvSide(item({ itemRating: 1, rating_scale: 4 }), {}, cfg, 'TYPE_D') === K.calcCommission(60, comm, 'TYPE_D', 'NHS0001'));
ok('sao cấp bill KHÔNG dùng để trừ (tránh lệch 2 phía)', ktvSide(item({}), { rating: 1, rating_scale: 4, BookingItems: [] }, cfg) === 150000);
const voided = { ...item({ itemRating: 1, rating_scale: 4 }), segments: [seg('A1', 60, { voided: true, note: 'CHANGED' })] };
ok('dự phòng 60′: bỏ dịch vụ KTV bị đổi ra khi tìm sao', K.ktvRatingOnItem(null, { BookingItems: [voided] }, 'A1').rating === 0);
console.log(JSON.stringify({ failed: fail })); if (fail) process.exitCode = 1;
