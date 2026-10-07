// TEST only: one unrated FEEDBACK order so the kiosk can be screenshotted. CLEANUP=1 removes it.
const fs = require('fs'); const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
const P = process.env.PREFIX || 'DEMO5LANG'; const KTV = `${P}-KTV`; const N = Number(process.env.COUNT || 1); const IDS = Array.from({ length: Math.max(N, 3) }, (_, i) => `${P}-B${i + 1}`);
const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s, p = []) => db.query(s, p);
const vnNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
async function cleanup() {
  await q('begin'); await q(`select set_config('app.ktvd_formula_revision', '2', true)`);
  await q('delete from "KTVDTurnLedger" where staff_id=$1', [KTV]).catch(() => 0);
  await q('delete from "KTVDRecomputeQueue" where booking_id=any($1)', [IDS]).catch(() => 0);
  await q('delete from "KTVServiceHoursLedger" where staff_id=$1', [KTV]).catch(() => 0);
  await q('delete from "StaffNotifications" where "bookingId"=any($1) or "employeeId"=$2', [IDS, KTV]);
  await q('delete from "BookingItems" where "bookingId"=any($1)', [IDS]); await q('delete from "BookingGuests" where booking_id=any($1)', [IDS]);
  await q('delete from "Bookings" where id=any($1)', [IDS]); await q('delete from "Staff" where id=$1', [KTV]);
  await q('commit');
  console.log('cleaned', (await q('select count(*) n from "Bookings" where id like $1', [P + '%'])).rows[0].n, 'left');
}
(async () => {
  await db.connect();
  try {
    await cleanup(); if (process.env.CLEANUP) return;
    await q(`insert into "Staff"(id,full_name,status,gender,position,work_type,online_status) values($1,'KTV Demo 5 ngôn ngữ','ĐANG LÀM','Female','KTV','TYPE_D','AT_VENUE')`, [KTV]);
    const cutoff = Number((await q(`select value from "SystemConfigs" where key='spa_day_cutoff_hours'`)).rows[0]?.value ?? 7);
    const day = new Date(Date.now() + (7 - cutoff) * 3600e3).toISOString().slice(0, 10);
    const endAt = new Date(Date.now() - 2 * 60e3), startAt = new Date(endAt.getTime() - 3600e3);
    for (const B of IDS.slice(0, N)) {
      await q(`insert into "Bookings"(id,"billCode","bookingDate","timeBooking","customerName",notes,status,"totalAmount","customerLang","timeStart",source,"createdAt","updatedAt") values($1,$1,$2,$3,'Khách chấm kiosk 5NN','DEMO 5 ngon ngu; xoa sau test','FEEDBACK',300000,'vi',$4,'STANDARD_WALK_IN',now(),now())`, [B, day, vnNow(), startAt.toISOString().slice(0, 19)]);
      await q(`insert into "BookingGuests"(id,booking_id,guest_index,customer_name) values($1,$2,0,'Khách chấm kiosk 5NN')`, [`${B}-G1`, B]);
      await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options,guest_id,"technicianCodes",segments) values($1,$2,'SEQ_TEST_SVC_60',1,300000,'FEEDBACK','{}',$3,$4,$5)`,
        [`${B}-I1`, B, `${B}-G1`, [KTV], JSON.stringify([{ id: `${B}-S1`, ktvId: KTV, duration: 60, startTime: '10:00', endTime: '11:00', actualStartTime: startAt.toISOString(), actualEndTime: endAt.toISOString(), handoverTime: endAt.toISOString() }])]);
      await q('update "Bookings" set "accessToken"=$1 where id=$1', [B]);
      console.log('seeded', B);
    }
  } finally { await db.end(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
