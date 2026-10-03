/** Mô phỏng engine sổ Loại D theo thang: thang 4 y như cũ, thang 5 trừ/thưởng theo bảng thang 5. */
import { computeRows } from '@/lib/services/KtvDLedgerEngine';
import { buildRatingConfig } from '@/lib/services/RatingScaleService';
let fail = 0; const ok = (n: string, c: boolean, d: any = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`); };
const rc = buildRatingConfig({});
const configs: any = { rateVIP: 180000, ratePT: 120000, ratingDeductions: rc.typeD[4], ratingDeductionsByScale: rc.typeD,
  cutoffHours: 7, taxRate: 0, taxEffectiveFrom: null, bonusEnabled: true, bonusPerGuest: 20000 };
const T = '2026-10-02T03:00:00Z', E = '2026-10-02T04:00:00Z';
const booking = (id: string, rating: number, scale: number) => ({ id, billCode: id, timeStart: T, status: 'DONE',
  BookingItems: [{ id: id + '-I', serviceId: 'NHS0001', guest_id: id + '-G', technicianCodes: ['D1'], status: 'DONE', tip: 0,
    segments: [{ id: 's', ktvId: 'D1', duration: 60, startTime: '10:00', endTime: '11:00', actualStartTime: T, actualEndTime: E }] }],
  BookingGuests: [{ id: id + '-G', rating, rating_scale: scale }] });
const row = (r: number, sc: number) => computeRows([booking(`B${r}${sc}`, r, sc) as any], ['D1'], { NHS0001: { nameVN: 'DV' } } as any, configs)[0];
console.log('sao/thang | trừ | tiền net | thưởng');
const expect: [number, number, number, number][] = [ // rating, scale, deduction, bonus>0
  [4, 4, 0, 1], [3, 4, 0.25, 0], [1, 4, 0.75, 0],
  [5, 5, 0, 1], [4, 5, 0, 0], [3, 5, 0.25, 0], [2, 5, 0.5, 0], [1, 5, 0.75, 0],
];
for (const [r, sc, d, b] of expect) {
  const x = row(r, sc);
  console.log(`  ${r}/${sc} | ${x.deduction_rate} | ${x.commission_net} | ${x.bonus_amount}`);
  ok(`${r}/${sc}: trừ ${d * 100}%, ${b ? 'có' : 'không'} thưởng`, x.deduction_rate === d && (x.bonus_amount > 0) === !!b && x.rating_scale === sc, x);
}
const legacy = computeRows([{ ...booking('BL', 5, 4) } as any], ['D1'], { NHS0001: { nameVN: 'DV' } } as any, configs)[0];
ok('dữ liệu cũ 5 trên thang 4: trừ 0%, có thưởng (như trước)', legacy.deduction_rate === 0 && legacy.bonus_amount > 0, legacy);
console.log(JSON.stringify({ failed: fail })); if (fail) process.exitCode = 1;
