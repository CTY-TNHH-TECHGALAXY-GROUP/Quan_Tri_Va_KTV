/**
 * QA — Phân công "mồ côi" chặn bàn giao (ca T027 04/10/2026).
 *
 * Áp 2 hàm trong supabase/migrations/20261004150000_fix_orphan_assignment_blocks_release.sql
 * BÊN TRONG một transaction trên DB thật, dựng 5 kịch bản rồi ROLLBACK toàn bộ.
 * Không để lại thay đổi nào. Cần DIRECT_URL/DATABASE_URL trong .env.local.
 *
 * Chạy: npx tsx --env-file=.env.local scripts/qa/qa_orphan_assignment_rollback.ts
 */
import { Client } from 'pg';
import { readFileSync } from 'fs';
const ok = (n: string, c: boolean, extra = '') => console.log(`  ${c ? 'DAT ' : 'HONG'} | ${n}${extra ? ' — ' + extra : ''}`);
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('BEGIN');
  try {
    // Áp 2 hàm mới TRONG transaction (sẽ rollback)
    await c.query(readFileSync('supabase/migrations/20261004150000_fix_orphan_assignment_blocks_release.sql', 'utf8'));
    console.log('A. Tai hien ca T027 (04/10): dong mo coi item1 + 003 QUEUED, turn dang o 002-A');
    await c.query(`update "KtvAssignments" set status='QUEUED' where employee_id='T027' and booking_item_id='11NDK-003-04102026-item1'`);
    await c.query(`update "KtvAssignments" set status='ACTIVE' where employee_id='T027' and booking_item_id='11NDK-002-04102026-item1'`);
    await c.query(`update "TurnQueue" set status='assigned', current_order_id='11NDK-002-04102026-A' where employee_id='T027' and date='2026-10-04'`);
    const r = (await c.query(`select promote_next_assignment('T027','2026-10-04') r`)).rows[0].r;
    ok('promotion thanh cong', r?.success === true, JSON.stringify(r));
    const st = (await c.query(`select booking_item_id, status from "KtvAssignments" where employee_id='T027' and business_date='2026-10-04' order by booking_item_id`)).rows;
    ok('dong mo coi item1 -> COMPLETED', st.find((x: any) => x.booking_item_id.endsWith('002-04102026-item1'))?.status === 'COMPLETED');
    ok('003 duoc kich hoat ACTIVE', st.find((x: any) => x.booking_item_id.endsWith('003-04102026-item1'))?.status === 'ACTIVE');
    const tq = (await c.query(`select current_order_id from "TurnQueue" where employee_id='T027' and date='2026-10-04'`)).rows[0];
    ok('TurnQueue tro sang 003', tq?.current_order_id === '11NDK-003-04102026');

    console.log('B. Khong dong nham dong HOP LE (KTV con tren technicianCodes)');
    const ext = (await c.query(`select ka.employee_id, ka.booking_item_id, ka.status from "KtvAssignments" ka join "BookingItems" bi on bi.id=ka.booking_item_id where ka.status='ACTIVE' and ka.business_date='2026-10-04' and lower(ka.employee_id) = any(select lower(x) from unnest(bi."technicianCodes") x) limit 1`)).rows[0];
    if (ext) {
      const bd = (await c.query(`select business_date from "KtvAssignments" where employee_id=$1 and booking_item_id=$2`, [ext.employee_id, ext.booking_item_id])).rows[0].business_date;
      const r2 = (await c.query(`select promote_next_assignment($1,$2) r`, [ext.employee_id, bd])).rows[0].r;
      const still = (await c.query(`select status from "KtvAssignments" where employee_id=$1 and booking_item_id=$2`, [ext.employee_id, ext.booking_item_id])).rows[0].status;
      ok(`KTV ${ext.employee_id} dang ban that: promotion tu choi, dong giu ACTIVE`, r2?.success === false && still === 'ACTIVE', JSON.stringify(r2));
    } else ok('(khong co KTV ACTIVE hop le hom nay de thu)', true);

    console.log('C. 1KTV-2DV gop (dich vu con technicianCodes rong) - NH025 21/09');
    const before = (await c.query(`select count(*)::int n from "KtvAssignments" where employee_id='NH025' and business_date='2026-09-21' and status in ('ACTIVE','QUEUED','READY')`)).rows[0].n;
    const r3 = (await c.query(`select promote_next_assignment('NH025','2026-09-21') r`)).rows[0].r;
    const after = (await c.query(`select count(*)::int n from "KtvAssignments" where employee_id='NH025' and business_date='2026-09-21' and status in ('ACTIVE','QUEUED','READY')`)).rows[0].n;
    const left = (await c.query(`select ka.booking_item_id, ka.status, bi."technicianCodes" t from "KtvAssignments" ka join "BookingItems" bi on bi.id=ka.booking_item_id where ka.employee_id='NH025' and ka.business_date='2026-09-21' and ka.status in ('ACTIVE','QUEUED','READY')`)).rows;
    ok(`2 dong con gop (technicianCodes rong) bi dong (${before} -> ${after}); dong con lai co NH025 tren item`, before - after === 2 && left.every((x: any) => (x.t || []).map((y: string) => y.toUpperCase()).includes('NH025')), JSON.stringify(left));

    console.log('D. 2KTV-1DV: cau self-heal MOI khong dong dong cua KTV con ten tren item');
    const pair = (await c.query(`select ka.employee_id, ka.booking_item_id, ka.business_date, bi."technicianCodes" t from "KtvAssignments" ka join "BookingItems" bi on bi.id=ka.booking_item_id where array_length(bi."technicianCodes",1) >= 2 and lower(ka.employee_id) = any(select lower(x) from unnest(bi."technicianCodes") x) order by ka.business_date desc limit 1`)).rows[0];
    if (pair) {
      const upd = await c.query(`update "KtvAssignments" ka set updated_at = now() from "BookingItems" bi
        where bi.id = ka.booking_item_id and ka.employee_id=$1 and ka.business_date=$2 and ka.booking_item_id=$3
          and not (lower($1) = any(select lower(x) from unnest(coalesce(bi."technicianCodes", array[]::text[])) x))`, [pair.employee_id, pair.business_date, pair.booking_item_id]);
      ok(`item 2 KTV (${pair.t.join('+')}), KTV ${pair.employee_id}: dieu kien mo coi khop 0 dong`, upd.rowCount === 0);
      const other = (await c.query(`select count(*)::int n from "KtvAssignments" ka join "BookingItems" bi on bi.id=ka.booking_item_id where ka.booking_item_id=$1 and ka.employee_id<>$2 and not (lower(ka.employee_id) = any(select lower(x) from unnest(bi."technicianCodes") x))`, [pair.booking_item_id, pair.employee_id])).rows[0].n;
      ok('KTV con lai tren item cung khong bi coi la mo coi', other === 0);
    } else ok('(khong co item 2 KTV)', true);

    console.log('E. dispatch_confirm_booking: don dong cu cua T027 khi item1 duoc dieu phoi lai duoi 002-B');
    const sig = (await c.query(`select pg_get_function_arguments(oid) a from pg_proc where proname='dispatch_confirm_booking'`)).rows[0].a;
    console.log('   chu ky:', sig.slice(0, 300));
    await c.query(`update "KtvAssignments" set status='QUEUED' where employee_id='T027' and booking_item_id='11NDK-003-04102026-item1'`);
    await c.query(`update "KtvAssignments" set status='ACTIVE' where employee_id='T027' and booking_item_id='11NDK-002-04102026-item1'`);
    await c.query('SAVEPOINT e');
    try {
      const cur = (await c.query(`select b.status, b."technicianCode", b."bedId", b."roomName", b.notes from "Bookings" b where id='11NDK-002-04102026-B'`)).rows[0];
      const res = (await c.query(`select dispatch_confirm_booking($1::text, $2::date, $3::text, $4::text, $5::text, $6::text, $7::text,
          $8::jsonb, $9::jsonb) r`,
        ['11NDK-002-04102026-B', '2026-10-04', cur.status, cur.technicianCode, cur.bedId, cur.roomName, cur.notes,
         JSON.stringify([{ ktvId: 'EXT_34KCJ3', bookingItemId: '11NDK-002-04102026-item1' }]),
         JSON.stringify([{ id: '11NDK-002-04102026-item1' }])])).rows[0].r;
      const st2 = (await c.query(`select status from "KtvAssignments" where employee_id='T027' and booking_item_id='11NDK-002-04102026-item1'`)).rows[0].status;
      ok('dong T027/item1 (booking 002-A) bi dong khi dieu phoi 002-B', st2 === 'COMPLETED', `rpc=${JSON.stringify(res).slice(0,120)}`);
    } catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT e'); ok('goi dispatch_confirm_booking voi payload toi gian', false, e.message.slice(0, 160)); }
  } finally {
    await c.query('ROLLBACK');
    console.log('\n(da ROLLBACK toan bo — DB khong doi)');
    await c.end();
  }
})().catch(e => { console.error('LOI', e.message); process.exit(1); });
