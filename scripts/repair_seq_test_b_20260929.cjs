// Repair only the explicitly reported TEST fixture; refuse every other database/state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env.local')));
const ref = 'eknggruuiuadwldacpmb';
const url = new URL(env.DATABASE_URL);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
assert.ok(url.hostname === 'db.' + ref + '.supabase.co' || decodeURIComponent(url.username).endsWith('.' + ref));
const db = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 12000 });
(async () => {
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    const day = '2026-09-28', employee = 'SEQ_TEST_B';
    const oldId = 'SEQ_PENDING_20260928_5-A', nextId = 'SEQ_PENDING_20260928_3';
    const { rows: [turn] } = await db.query(`SELECT * FROM "TurnQueue" WHERE employee_id=$1 AND date=$2 FOR UPDATE`, [employee, day]);
    assert.ok(turn, 'TEST TurnQueue missing');
    const { rows: [next] } = await db.query(`SELECT * FROM "KtvAssignments" WHERE employee_id=$1 AND business_date=$2 AND booking_id=$3 AND status='ACTIVE' FOR UPDATE`, [employee, day, nextId]);
    assert.ok(next, 'Expected ACTIVE TEST assignment missing');
    if (turn.current_order_id === nextId) {
      await db.query('ROLLBACK');
      console.log('PASS TEST B already reconciled');
      return;
    }
    assert.equal(turn.current_order_id, oldId, 'Refuse unexpected TurnQueue owner');
    const { rows: oldItems } = await db.query(`SELECT segments,handover_status,handover_skipped FROM "BookingItems" WHERE "bookingId"=$1 FOR UPDATE`, [oldId]);
    assert.ok(oldItems.length, 'Prior TEST item missing');
    for (const item of oldItems) for (const seg of item.segments || []) {
      if (seg.ktvId !== employee || !seg.actualStartTime || seg.voided === true) continue;
      assert.ok(seg.actualEndTime, 'Refuse to move a working employee');
      assert.ok(seg.handoverTime || (item.handover_status === 'SKIPPED' && item.handover_skipped), 'Prior room not released');
    }
    const { rows: [target] } = await db.query(`SELECT status FROM "BookingItems" WHERE id=$1 AND "bookingId"=$2`, [next.booking_item_id, nextId]);
    assert.ok(target && ['PREPARING', 'READY'].includes(target.status), 'Target TEST item changed');
    await db.query(`UPDATE "TurnQueue" SET status='assigned',current_order_id=$3,booking_item_id=$4,
      booking_item_ids=ARRAY[$4]::text[],room_id=$5,bed_id=$6,
      start_time=($7::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
      estimated_end_time=($8::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      WHERE employee_id=$1 AND date=$2`, [employee, day, nextId, next.booking_item_id, next.room_id, next.bed_id, next.planned_start_time, next.planned_end_time]);
    await db.query('SELECT dispatch_recompute_booking_status($1)', [nextId]);
    const { rows: [verified] } = await db.query(`SELECT t.current_order_id,t.status AS turn_status,b.status AS booking_status
      FROM "TurnQueue" t JOIN "Bookings" b ON b.id=t.current_order_id WHERE t.employee_id=$1 AND t.date=$2`, [employee, day]);
    assert.deepEqual(verified, { current_order_id: nextId, turn_status: 'assigned', booking_status: 'PREPARING' });
    await db.query('COMMIT');
    console.log('PASS repaired TEST B: TurnQueue points order 3; booking status PREPARING');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }
})().catch(error => { console.error('FAILED:', error.message); process.exitCode = 1; });
