// Real TEST PostgreSQL regression; fixture and migration are rolled back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env.local')));
const ref = 'eknggruuiuadwldacpmb';
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const url = new URL(env.DATABASE_URL);
assert.ok(url.hostname === `db.${ref}.supabase.co` || decodeURIComponent(url.username).endsWith(`.${ref}`));
require('ts-node').register({ project: path.join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: root, paths: { '@/*': ['./*'] } });
const { applySequentialLifecycle } = require('../lib/sequential-lifecycle');
const db = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 12000 });
const a = 'SEQ_FOLLOWUP_A', b = 'SEQ_FOLLOWUP_B', bookingId = 'SEQ_FOLLOWUP_1', itemId = `${bookingId}_ITEM`;
let day;
const at = time => `${day}T${time}:00+07:00`;
const item = async () => (await db.query('SELECT to_jsonb(i) value FROM "BookingItems" i WHERE id=$1', [itemId])).rows[0].value;
const booking = async () => (await db.query('SELECT to_jsonb(b) value FROM "Bookings" b WHERE id=$1', [bookingId])).rows[0].value;
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
async function start(employee, time) {
  const old = await item(), order = await booking(), segments = structuredClone(old.segments);
  const target = segments.find(segment => segment.ktvId === employee && !segment.actualStartTime);
  assert.ok(target);
  target.actualStartTime = at(time);
  const snapshot = pick(old, ['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId']);
  await db.query('SELECT ktv_start_service_atomic($1,$2,$3,\'[]\',$4,$5,$6,$7,$8)', [bookingId,
    JSON.stringify(pick(order, ['id','status','rating','timeStart'])), JSON.stringify([snapshot]),
    JSON.stringify([{ id: itemId, status: 'IN_PROGRESS', segments }]), employee, target.id, at(time),
    JSON.stringify({ status:'working', current_order_id:bookingId, booking_item_id:itemId, booking_item_ids:[itemId], start_time:time, estimated_end_time:target.endTime })]);
}
async function lifecycle(action, time) {
  const old = await item();
  const snapshot = pick(old, ['id','bookingId','status','segments','options','pauseStart','timeEnd','technicianCodes']);
  const patch = applySequentialLifecycle(old, { action, employeeId:a }, at(time), { id:'SEQ_FOLLOWUP_ADMIN' });
  await db.query('SELECT dispatch_sequential_lifecycle_atomic($1,$2,$3,$4,$5,\'{}\',$6)', [bookingId,itemId,JSON.stringify(snapshot),JSON.stringify(patch),action,Number(old.options.dispatchRevision || 0)]);
}
async function main() {
  await db.connect();
  try {
    await db.query('BEGIN');
    day = (await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS service_day")).rows[0].service_day;
    await db.query(fs.readFileSync(path.join(root,'supabase/migrations/20260929160000_live_queue_and_early_b.sql'),'utf8'));
    for (const employee of [a,b]) {
      await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status)
        VALUES($1,$1,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`, [employee]);
      await db.query('INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status) VALUES($1,$2,999,999,\'waiting\')', [employee,day]);
    }
    await db.query('INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount") VALUES($1,$1,$2,now(),\'STANDARD_WALK_IN\',300000)', [bookingId,day]);
    await db.query('INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,\'SEQ_TEST_SVC_90\',300000,\'NEW\',\'{}\')', [itemId,bookingId]);
    const segments = [
      {id:'a',ktvId:a,sequenceSlot:1,startTime:'15:20',endTime:'15:50',duration:30,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1'},
      {id:'b',ktvId:b,sequenceSlot:2,startTime:'15:50',endTime:'16:50',duration:60,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1'},
    ];
    await db.query('SELECT dispatch_commit_form($1,\'DISPATCH\',$2,\'{}\')', [bookingId,JSON.stringify({date:day,status:'PREPARING',technicianCode:`${a} - ${b}`,roomName:'SEQ TEST',bedId:'SEQ_TEST_BED_1',itemUpdates:[{id:itemId,status:'PREPARING',segments,options:{sequentialSlots:2},technicianCodes:[a,b],roomName:'SEQ TEST',bedId:'SEQ_TEST_BED_1'}],staffAssignments:segments.map(s=>({ktvId:s.ktvId,bookingItemId:itemId,segmentId:s.id,startTime:s.startTime,endTime:s.endTime,roomId:s.roomId,bedId:s.bedId,queuePos:999}))})]);
    await start(a,'15:20');
    await lifecycle('PAUSE','15:30');
    const before = await item(), edited = structuredClone(before.segments);
    edited[0].duration=45; edited[0].endTime='16:05';
    edited[1].startTime='15:45'; edited[1].duration=45; edited[1].endTime='16:30';
    await db.query('SELECT dispatch_commit_form($1,\'DISPATCH\',$2,\'{}\')', [bookingId,JSON.stringify({date:day,confirmOverlap:true,itemUpdates:[{id:itemId,segments:edited,options:before.options}]})]);
    assert.equal((await item()).status,'PAUSED');
    await lifecycle('RESUME','15:35');
    assert.equal((await item()).segments[1].actualStartTime,undefined);
    await start(b,'15:45');
    const both = await item();
    assert.ok(both.segments[0].actualStartTime && !both.segments[0].actualEndTime);
    assert.ok(both.segments[1].actualStartTime);
    console.log('PASS paused 45/45 dispatch, resume leaves B unstarted, B starts before A finishes');

    const nextBooking = 'SEQ_FOLLOWUP_2', nextItem = `${nextBooking}_ITEM`;
    await db.query('INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount") VALUES($1,$1,$2,now(),\'STANDARD_WALK_IN\',300000)', [nextBooking,day]);
    await db.query('INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,\'SEQ_TEST_SVC_60\',300000,\'NEW\',\'{}\')', [nextItem,nextBooking]);
    const nextSegment = {id:'next',ktvId:b,startTime:'16:00',endTime:'17:00',duration:60,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_2'};
    await db.query('SELECT dispatch_commit_form($1,\'DISPATCH\',$2,\'{}\')', [nextBooking,JSON.stringify({date:day,status:'PREPARING',technicianCode:b,roomName:'SEQ TEST',bedId:'SEQ_TEST_BED_2',itemUpdates:[{id:nextItem,status:'PREPARING',segments:[nextSegment],options:{},technicianCodes:[b],roomName:'SEQ TEST',bedId:'SEQ_TEST_BED_2'}],staffAssignments:[{ktvId:b,bookingItemId:nextItem,segmentId:'next',startTime:'16:00',endTime:'17:00',roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_2',queuePos:999}]})]);
    const status = (await db.query('SELECT status FROM "KtvAssignments" WHERE booking_item_id=$1', [nextItem])).rows[0].status;
    assert.equal(status,'QUEUED');
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    console.log('PASS next overlapping order is QUEUED while previous work remains ACTIVE');
  } finally {
    try { await db.query('ROLLBACK'); } finally { await db.end(); }
  }
}
main().catch(error => { console.error('FAILED:', error); process.exitCode=1; });
