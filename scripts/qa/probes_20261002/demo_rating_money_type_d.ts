/** Demo 03/10: KTV Loại D, 5 đơn khách chấm 1★…5★ (thang 5) qua kiosk → sổ Loại D trừ/thưởng đúng cấu hình.
 *  KEEP=1 giữ dữ liệu để chụp Kanban; CLEANUP=<prefix> chỉ dọn. */
import fs from 'node:fs';
import * as auth from '@/lib/auth-server';
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
(auth as any).requireBusinessUser = async () => ({ techCode: 'QA', businessUserId: 'QA' });
const feedback = require('@/app/reception/feedback/_components/actions');
const { recomputeTurnRows } = require('@/lib/services/KtvDLedgerWriter');
const { getSupabaseAdmin } = require('@/lib/supabaseAdmin');
const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s: string, p: any[] = []) => db.query(s, p);
const P = process.env.CLEANUP || `DEMOSAO-${Date.now().toString(36).toUpperCase().slice(-5)}`;
const KTV = `${P}-KTVD`; const B = (n: number) => `${P}-B${n}`;
const vnNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
async function cleanup() {
  const ids = [1, 2, 3, 4, 5].map(B);
  await q('begin');
  // Ledger guard trigger only accepts writes from the current writer revision.
  await q(`select set_config('app.ktvd_formula_revision', '2', true)`);
  for (const t of ['KTVDTurnLedger']) await q(`delete from "${t}" where staff_id=$1`, [KTV]);
  await q(`delete from "KTVDRecomputeQueue" where booking_id=any($1)`, [ids]).catch(() => 0);
  await q(`delete from "KTVServiceHoursLedger" where staff_id=$1`, [KTV]).catch(() => 0);
  await q('delete from "StaffNotifications" where "bookingId"=any($1) or "employeeId"=$2', [ids, KTV]);
  await q('delete from "BookingItems" where "bookingId"=any($1)', [ids]); await q('delete from "BookingGuests" where booking_id=any($1)', [ids]);
  await q('delete from "Bookings" where id=any($1)', [ids]); await q('delete from "Staff" where id=$1', [KTV]);
  await q('commit');
  console.log('cleanup', P, 'leftover bookings', (await q('select count(*) n from "Bookings" where id like $1', [`${P}%`])).rows[0].n);
}
(async () => {
  await db.connect();
  try {
    if (process.env.CLEANUP) return await cleanup();
    // Bonus 5★ = 20 điểm × 1000đ (ghi thẳng DB: key "enable_*" qua API sẽ đăng xuất KTV Loại D).
    for (const [k, v] of [['ktv_type_d_bonus_points', 20], ['ktv_bonus_rate_TYPE_D', 1000], ['enable_ktv_bonus_TYPE_D', true]] as const)
      await q(`insert into "SystemConfigs"(id,key,value,updated_at) values(gen_random_uuid(),$1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()`, [k, JSON.stringify(v)]);
    await q(`insert into "Staff"(id,full_name,status,gender,position,work_type,online_status) values($1,'KTV Demo Sao (Loại D)','ĐANG LÀM','Female','KTV','TYPE_D','AT_VENUE')`, [KTV]);
    const cutoff = Number((await q(`select value from "SystemConfigs" where key='spa_day_cutoff_hours'`)).rows[0]?.value ?? 7);
    const day = new Date(Date.now() + (7 - cutoff) * 3600e3).toISOString().slice(0, 10);
    const endAt = new Date(Date.now() - 2 * 60e3), startAt = new Date(endAt.getTime() - 60 * 60e3);
    const itemIds: string[] = [];
    for (let n = 1; n <= 5; n++) {
      await q(`insert into "Bookings"(id,"billCode","bookingDate","timeBooking","customerName",notes,status,"totalAmount","customerLang","timeStart",source,"createdAt","updatedAt") values($1,$1,$2,$3,$4,'DEMO sao; xoa sau test','FEEDBACK',300000,'vi',$5,'STANDARD_WALK_IN',now(),now())`,
        [B(n), day, vnNow(), `Khách demo ${n} sao`, startAt.toISOString().slice(0, 19)]);
      await q(`insert into "BookingGuests"(id,booking_id,guest_index,customer_name) values($1,$2,0,$3)`, [`${B(n)}-G1`, B(n), `Khách demo ${n} sao`]);
      await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options,guest_id,"technicianCodes",segments) values($1,$2,'SEQ_TEST_SVC_60',1,300000,'FEEDBACK','{}',$3,$4,$5)`,
        [`${B(n)}-I1`, B(n), `${B(n)}-G1`, [KTV], JSON.stringify([{ id: `${B(n)}-S1`, ktvId: KTV, duration: 60, startTime: '10:00', endTime: '11:00', actualStartTime: startAt.toISOString(), actualEndTime: endAt.toISOString(), handoverTime: endAt.toISOString() }])]);
      itemIds.push(`${B(n)}-I1`);
      // Khách chấm qua kiosk (đúng action thật), thang 5 sao.
      const r = await feedback.submitFeedbackAction({ bookingId: B(n), isGuestFlow: false, ktvList: [{ itemId: `${B(n)}-I1`, ktvId: KTV, ktvName: 'KTV Demo' }], globalRating: n, globalComment: '', violations: [], ratingScale: 5 });
      if (r?.success === false) throw new Error('rating ' + n + ': ' + r.error);
    }
    await recomputeTurnRows(getSupabaseAdmin(), itemIds);
    const rows = (await q(`select booking_item_id, rating_used, rating_scale, deduction_rate, commission_gross, commission_net, bonus_amount from "KTVDTurnLedger" where staff_id=$1 order by booking_item_id`, [KTV])).rows;
    const vnd = (x: any) => Math.round(Number(x)).toLocaleString('vi-VN') + 'đ';
    console.log(`\nKTV ${KTV} — sổ Loại D (nguồn ví / lịch sử KTV và báo cáo quản lý)`);
    console.log('Đơn | Khách chấm | Trừ | Tiền gốc | Tiền sau trừ | Thưởng | Tổng nhận');
    for (const r of rows) console.log(`${r.booking_item_id.replace(P + '-', '')} | ${r.rating_used}/${r.rating_scale} | ${Math.round(r.deduction_rate * 100)}% | ${vnd(r.commission_gross)} | ${vnd(r.commission_net)} | ${vnd(r.bonus_amount)} | ${vnd(Number(r.commission_net) + Number(r.bonus_amount))}`);
    const notes = (await q(`select type, message from "StaffNotifications" where "employeeId"=$1 order by "createdAt"`, [KTV])).rows;
    console.log('\nThông báo KTV nhận:'); for (const x of notes) console.log(`  [${x.type}] ${x.message}`);
    fs.writeFileSync('_plans/probes_claude_20261002/demo_rating_money_type_d.json', JSON.stringify({ prefix: P, ktv: KTV, rows, notes }, null, 2));
    console.log('\nPREFIX', P);
  } catch (e: any) { console.log('ERR', e.message); await cleanup(); process.exitCode = 1; }
  finally { if (!process.env.KEEP && !process.env.CLEANUP && !process.exitCode) await cleanup(); await db.end(); }
})();
