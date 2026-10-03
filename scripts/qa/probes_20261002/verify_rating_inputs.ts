/** GĐ2: các action ghi đánh giá theo thang (kẹp, ghi rating_scale, trần khi có góp ý) + kiểm API cài đặt. Dữ liệu QA riêng, tự dọn. */
import fs from 'node:fs';
import * as auth from '@/lib/auth-server';
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
(auth as any).requirePermission = async () => null;
(auth as any).requireBusinessUser = async () => ({ techCode: 'QA', businessUserId: 'QA' });
const dispatch = require('@/app/reception/dispatch/actions');
const feedback = require('@/app/reception/feedback/_components/actions');
const { ratingConfigPatchError } = require('@/lib/services/RatingScaleService');
const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s: string, p: any[] = []) => db.query(s, p);
const P = `QARS-${Date.now().toString(36).toUpperCase().slice(-6)}`; let fail = 0;
const ok = (n: string, c: any, d: any = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' — ' + JSON.stringify(d).slice(0, 250)}`); };
const B = (n: number) => `${P}-B${n}`;
async function mk(n: number) {
  await q(`insert into "Bookings"(id,"billCode","bookingDate","customerName",notes,status,"totalAmount","createdAt","updatedAt") values($1,$1,now(),'QA rating','xoa sau test','FEEDBACK',1,now(),now())`, [B(n)]);
  const g = (await q(`insert into "BookingGuests"(id,booking_id,guest_index,customer_name) values($2,$1,0,'QA') returning id`, [B(n), `${B(n)}-G1`])).rows[0].id;
  await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options,guest_id,"technicianCodes") values($1,$2,'NHP0001',1,1,'FEEDBACK','{}',$3,$4)`, [`${B(n)}-I1`, B(n), g, ['QAKTV']]);
  return g;
}
const row = async (t: string, col: string, id: string) => (await q(`select * from "${t}" where ${col}=$1`, [id])).rows[0];
(async () => {
  await db.connect();
  try {
    const g1 = await mk(1);
    const r1 = await dispatch.submitGuestRating(g1, 7, undefined, 5);
    const gg = await row('BookingGuests', 'id', g1), it = await row('BookingItems', 'id', `${B(1)}-I1`);
    ok('Kanban thang 5: chấm 7 → kẹp 5, ghi rating_scale 5 cho khách + item', r1?.success !== false && Number(gg.rating) === 5 && gg.rating_scale === 5 && it.itemRating === 5 && it.rating_scale === 5, [r1, gg.rating, gg.rating_scale, it.itemRating, it.rating_scale]);
    const g2 = await mk(2);
    await dispatch.submitCustomerRating(B(2), 3);
    const b2 = await row('Bookings', 'id', B(2)), i2 = await row('BookingItems', 'id', `${B(2)}-I1`);
    const cfgScale = Number((await q(`select value from "SystemConfigs" where key='customer_rating_scale'`)).rows[0]?.value) === 5 ? 5 : 4;
    ok(`không gửi thang → theo cấu hình hiện tại (${cfgScale}), ghi rating_scale ${cfgScale}`, Number(b2.rating) === 3 && b2.rating_scale === cfgScale && i2.rating_scale === cfgScale, [b2.rating, b2.rating_scale]);
    const bad = await dispatch.submitCustomerRating(B(2), 0, undefined, 4);
    ok('chấm 0 → bị từ chối', bad?.success === false, bad);
    const g3 = await mk(3);
    const f3 = await feedback.submitFeedbackAction({ bookingId: B(3), isGuestFlow: false, ktvList: [{ itemId: `${B(3)}-I1`, ktvId: 'QAKTV', ktvName: 'QA' }], globalRating: 5, globalComment: '', violations: ['x'], ratingScale: 5 });
    const i3 = await row('BookingItems', 'id', `${B(3)}-I1`), b3 = await row('Bookings', 'id', B(3));
    ok('kiosk thang 5 có góp ý: 5 → hạ về 4 (thang−1), ghi rating_scale 5', f3?.success !== false && i3.itemRating === 4 && i3.rating_scale === 5 && b3.rating_scale === 5, [f3?.error, i3.itemRating, i3.rating_scale, b3.rating_scale]);
    const g4 = await mk(4);
    const f4 = await feedback.submitFeedbackAction({ bookingId: B(4), isGuestFlow: false, ktvList: [{ itemId: `${B(4)}-I1`, ktvId: 'QAKTV', ktvName: 'QA' }], globalRating: 4, globalComment: '', violations: [], ratingScale: 4 });
    const i4 = await row('BookingItems', 'id', `${B(4)}-I1`);
    const fb = (await q(`select "employeeId", type, message from "StaffNotifications" where "bookingId"=$1 and type='FEEDBACK'`, [B(3)])).rows;
    ok('kiosk ghi được thông báo FEEDBACK cho đúng KTV (trước đây lỗi cột referenceId)', fb.length === 1 && fb[0].employeeId === 'QAKTV' && /4\/5 sao/.test(fb[0].message), fb);
    ok('kiosk thang 4 không góp ý: 4/4 như cũ', f4?.success !== false && i4.itemRating === 4 && i4.rating_scale === 4, [f4?.error, i4.itemRating]);
    ok('API cài đặt: thang 6 bị chặn', !!ratingConfigPatchError({ customer_rating_scale: 6 }));
    ok('API cài đặt: % > 100 bị chặn', !!ratingConfigPatchError({ ktv_abc_rating_deduction_5: { '1': 1.5 } }));
    ok('API cài đặt: nhãn > 40 ký tự bị chặn', !!ratingConfigPatchError({ rating_labels: { 5: { 1: { internal: 'x'.repeat(41) } } } }));
    ok('API cài đặt: dữ liệu hợp lệ được nhận', ratingConfigPatchError({ customer_rating_scale: 5, ktv_abc_rating_deduction_5: { '1': 0.3 }, rating_labels: { 5: { 1: { internal: 'Rất tệ' } } } }) === null);
  } catch (e: any) { fail++; console.log('RUN ERR', e.message); }
  finally {
    const ids = [1, 2, 3, 4].map(B);
    await q('delete from "StaffNotifications" where "bookingId"=any($1)', [ids]).catch(() => 0);
    await q('delete from "BookingItems" where "bookingId"=any($1)', [ids]); await q('delete from "BookingGuests" where booking_id=any($1)', [ids]);
    await q('delete from "Bookings" where id=any($1)', [ids]);
    console.log('leftovers', (await q('select count(*) n from "Bookings" where id like $1', [`${P}%`])).rows[0].n);
    await db.end(); console.log(JSON.stringify({ failed: fail })); if (fail) process.exitCode = 1;
  }
})();
