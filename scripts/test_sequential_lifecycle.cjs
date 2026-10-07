const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['./*'] } });
const { PGlite } = require('pglite-2');
const { applySequentialLifecycle, employeeIsPaused } = require('../lib/sequential-lifecycle');
const { sequentialSlotsComplete } = require('../lib/dispatch-status');
const { workedMsOf } = require('../lib/segment-time');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

async function main() {
  const db = new PGlite();
  // Reuse the minimal schema already used by the operational regression gate.
  const fixture = read('scripts/test_sequential_deep_fixes.cjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
  await db.exec(fixture);
  await db.exec(`ALTER TABLE "Bookings" ADD COLUMN "totalAmount" numeric DEFAULT 100;
    ALTER TABLE "BookingItems" ADD COLUMN "pauseStart" timestamptz, ADD COLUMN price numeric DEFAULT 100, ADD COLUMN quantity numeric DEFAULT 1;
    ALTER TABLE "Services" ADD COLUMN duration numeric DEFAULT 90;
    ALTER TABLE "Staff" ADD COLUMN work_type text DEFAULT 'TYPE_A';
    ALTER TABLE "TurnLedger" ADD COLUMN is_punished boolean DEFAULT false;
    ALTER TABLE "TurnQueue" ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN manual_adjustment integer DEFAULT 0;`);
  const migrations = 'supabase/migrations/';
  const unwrap = read(migrations + '20260914120000_auto_complete_feedback_after_5m.sql');
  const start = unwrap.indexOf('CREATE OR REPLACE FUNCTION jsonb_unwrap_string(');
  await db.exec(unwrap.slice(start, unwrap.indexOf('$$;', start) + 3));
  for (const migration of ['20260925120000_live_sequential_handoff.sql',
    '20260926120000_dispatch_edit_history.sql','20260926140000_ktv_finish_service_atomic.sql',
    '20260927120000_sequential_operational_consistency.sql','20260927150000_sequential_scoped_lifecycle.sql',
    '20260927180000_unassign_unstarted_dispatch_staff.sql','20260927190000_sync_unstarted_dispatch_plan.sql',
    '20260927200000_dispatch_form_commit.sql','20260927210000_turn_queue_edits.sql',
    '20260927220000_extend_running_sequential_a.sql','20260927230000_adjust_running_sequential_duration.sql',
    '20260928010000_start_after_completed_queue.sql']) {
    await db.exec(read(migrations + migration));
  }
  const assignmentSchema = read(migrations + '20260502150000_create_ktv_assignments.sql');
  await db.exec(assignmentSchema.slice(assignmentSchema.indexOf('DO $$ BEGIN'),assignmentSchema.indexOf('-- 2.')));
  await db.exec(`ALTER TABLE "KtvAssignments" ALTER COLUMN status TYPE "KtvAssignmentStatus" USING status::"KtvAssignmentStatus";
    ALTER TABLE "KtvAssignments" ADD CONSTRAINT assignment_booking_fk FOREIGN KEY (booking_id) REFERENCES "Bookings"(id);
    CREATE UNIQUE INDEX idx_ktvassignments_one_active_per_day ON "KtvAssignments"(employee_id,business_date) WHERE status='ACTIVE';`);
  assert.equal((await db.query(`SELECT count(*)::int AS total FROM pg_trigger WHERE tgname IN ('guard_sequential_item_update_trigger','zz_dispatch_edit_history') AND NOT tgisinternal`)).rows[0].total,2);
  for (const fn of ['dispatch_apply_edit(text,text,jsonb,jsonb)', 'dispatch_save_sequential_update(text,jsonb,boolean)',
    'dispatch_sequential_lifecycle_atomic(text,text,jsonb,jsonb,text,jsonb,bigint)', 'ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text)']) {
    const access = (await db.query(`SELECT has_function_privilege('service_role',$1,'EXECUTE') AS service,
      has_function_privilege('authenticated',$1,'EXECUTE') AS client,has_function_privilege('anon',$1,'EXECUTE') AS anon`,[fn])).rows[0];
    assert.deepEqual(access,{service:true,client:false,anon:false});
  }
  await db.exec(read('_plans/sequential_migration_preflight_20260927.sql'));
  const postChecks = await db.exec(read('_plans/sequential_migration_postcheck_20260927.sql'));
  assert.equal(postChecks[0].rows.length,11);
  for (const result of postChecks[0].rows) {
    assert.equal(result.exists_after_migration,true);assert.equal(result.service_can_execute,true);
    assert.equal(result.client_can_execute,false);assert.equal(result.anon_can_execute,false);
  }
  assert.ok(postChecks[1].rows.every(trigger=>trigger.enabled_mode==='O'));
  assert.equal(postChecks[2].rows.length,0);
  console.log('PASS lifecycle migrations in order with their real guard/audit triggers, all 11 RPC access checks and ACTIVE uniqueness constraint');
  const at = minute => `2026-09-26T03:${String(minute).padStart(2,'0')}:00Z`;
  const row = async id => (await db.query('SELECT * FROM "BookingItems" WHERE id=$1', [id])).rows[0];
  const seed = async (key, aDone = false, bStarted = false, bAssigned = true) => {
    const aId = key+'A', bId = key+'B';
    await db.query(`INSERT INTO "Bookings"(id,status) VALUES($1,'IN_PROGRESS');`, [key]);
    await db.query(`INSERT INTO "Staff"(id,status) VALUES($1,'ĐANG LÀM'),($2,'ĐANG LÀM')`, [aId,bId]);
    const segments = [{ id:key+'-a', ktvId:aId, sequenceSlot:1, roomId:'R', bedId:'X', startTime:'10:00',endTime:'10:30',duration:30, actualStartTime:at(0), ...(aDone ? {actualEndTime:at(30)} : {}) },
      { id:key+'-b', ktvId:bId, sequenceSlot:2, roomId:'R', bedId:'X', startTime:'10:30',endTime:'11:00',duration:30, ...(bStarted ? {actualStartTime:at(30)} : {}) }];
    if (!bAssigned) segments.pop();
    await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",status,segments,options) VALUES($1,$2,'svc','IN_PROGRESS',$3,$4)`, [key+'item',key,JSON.stringify(segments),JSON.stringify({sequentialSlots:2,dispatchRevision:0, serviceNamesForKtvs:{[aId]:'Tên A riêng',[bId]:'Tên B riêng'}})]);
    for (const [id, seg] of [[aId, segments[0]], ...(bAssigned ? [[bId, segments[1]]] : [])]) {
      await db.query(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,segment_id,status) VALUES($1,'2026-09-26',$2,$3,$4,'ACTIVE')`, [id,key,key+'item',seg.id]);
      await db.query(`INSERT INTO "TurnQueue"(employee_id,date,status,current_order_id,booking_item_id,booking_item_ids) VALUES($1,'2026-09-26','working',$2,$3,ARRAY[$3]::text[])`, [id,key,key+'item']);
      await db.query(`INSERT INTO "TurnLedger"(date,booking_id,employee_id) VALUES('2026-09-26',$1,$2)`, [key,id]);
    }
    return key+'item';
  };
  const commit = async (id, request, timestamp, expected) => {
    const item = expected || await row(id);
    const patch = applySequentialLifecycle(item, request, timestamp, {id:'admin',name:'Quầy test'});
    const snapshot = Object.fromEntries(['id','bookingId','status','segments','options','pauseStart','timeEnd','technicianCodes'].map(key=>[key,item[key]]));
    await db.query(`SELECT dispatch_sequential_lifecycle_atomic($1,$2,$3,$4,$5,$6,$7)`,
      [item.bookingId,id,JSON.stringify(snapshot),JSON.stringify(patch),request.action,JSON.stringify({id:'admin',name:'Quầy test'}),Number(item.options.dispatchRevision || 0)]);
    return row(id);
  };
  const assignment = async (employee, item) => (await db.query('SELECT status,segment_id FROM "KtvAssignments" WHERE employee_id=$1 AND booking_item_id=$2',[employee,item])).rows[0];
  const punished = async employee => (await db.query('SELECT is_punished FROM "TurnLedger" WHERE employee_id=$1',[employee])).rows[0].is_punished;

  // Reproduce the legacy dispatcher storing B's catalogue 90 minutes, then verify the forward RPC normalizes it.
  const initialId = await seed('initial90');
  await db.exec(`DELETE FROM "BookingItems" WHERE id='initial90item';
    INSERT INTO "BookingItems"(id,"bookingId","serviceId",status,options,segments) VALUES('initial90item','initial90','svc','NEW','{}','[]');
    UPDATE "TurnQueue" SET status='assigned' WHERE current_order_id='initial90';
    CREATE OR REPLACE FUNCTION dispatch_confirm_booking(bid text,day date,st text,tech text,bed text,room text,notes text,assignments jsonb,updates jsonb)
    RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE e jsonb; BEGIN
      FOR e IN SELECT value FROM jsonb_array_elements(updates) LOOP
        UPDATE "BookingItems" SET segments=e->'segments',options=e->'options',status='PREPARING' WHERE id=e->>'id';
      END LOOP;
      UPDATE "KtvAssignments" SET planned_start_time='2026-09-26 16:05+07',planned_end_time='2026-09-26 17:35+07' WHERE booking_id=bid AND employee_id='initial90B';
      RETURN '{"success":true}'; END $$;`);
  const initialSegments = [{id:'initial90-a',ktvId:'initial90A',sequenceSlot:1,startTime:'15:20',endTime:'16:05',duration:45},
    {id:'initial90-b',ktvId:'initial90B',sequenceSlot:2,startTime:'16:05',endTime:'16:50',duration:45}];
  await db.query(`SELECT dispatch_apply_edit('initial90','DISPATCH',$1,'{}')`,[JSON.stringify({date:'2026-09-26',itemUpdates:[{id:initialId,segments:initialSegments,options:{sequentialSlots:2,dispatchRevision:0}}]})]);
  const ownPlan = (await db.query(`SELECT planned_start_time,planned_end_time,EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS minutes FROM "KtvAssignments" WHERE employee_id='initial90B'`)).rows[0];
  assert.equal(Number(ownPlan.minutes),45);
  assert.equal(Number((await db.query(`SELECT duration FROM "Services" WHERE id='svc'`)).rows[0].duration),90);
  assert.equal(Number((await db.query(`SELECT EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS minutes FROM "KtvAssignments" WHERE employee_id='initial90A'`)).rows[0].minutes),45);
  assert.equal(new Date(ownPlan.planned_end_time).toISOString(),'2026-09-26T09:50:00.000Z');
  const ownQueue = (await db.query(`SELECT start_time,estimated_end_time FROM "TurnQueue" WHERE employee_id='initial90B'`)).rows[0];
  assert.equal(ownQueue.start_time,'16:05:00'); assert.equal(ownQueue.estimated_end_time,'16:50:00');
  console.log('PASS initial dispatch normalizes B 16:05+45=16:50 despite legacy 90-minute assignment; TurnQueue agrees');
  for (const [minutes,name] of [[35,'B sửa lần 1'],[40,'B sửa lần 2']]) {
    const saved = await row(initialId);
    const revised = structuredClone(saved.segments);
    revised.find(seg=>seg.sequenceSlot===2).startTime='16:10';
    revised.find(seg=>seg.sequenceSlot===2).duration=minutes;
    revised.find(seg=>seg.sequenceSlot===2).endTime=minutes===35?'16:45':'16:50';
    const options = {...saved.options,serviceNamesForKtvs:{...saved.options.serviceNamesForKtvs,initial90A:'Tên A giữ nguyên',initial90B:name}};
    await db.query(`SELECT dispatch_apply_edit('initial90','DISPATCH',$1,'{}')`,[JSON.stringify({date:'2026-09-26',itemUpdates:[{id:initialId,segments:revised,options}]})]);
    const latest = await row(initialId);
    assert.equal(latest.segments.find(seg=>seg.sequenceSlot===2).duration,minutes);
    assert.equal(latest.options.serviceNamesForKtvs.initial90B,name);assert.equal(latest.options.serviceNamesForKtvs.initial90A,'Tên A giữ nguyên');
    assert.equal(Number((await db.query(`SELECT EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS minutes FROM "KtvAssignments" WHERE employee_id='initial90B' AND booking_item_id='initial90item'`)).rows[0].minutes),minutes);
    assert.ok(latest.options.dispatchRevision>saved.options.dispatchRevision);
  }
  console.log('PASS full migration chain redispatches B edits twice from latest save; own minutes/assignment/name/history agree');


  const nightId = await seed('initialNight');
  await db.exec(`DELETE FROM "BookingItems" WHERE id='initialNightitem';
    INSERT INTO "BookingItems"(id,"bookingId","serviceId",status,options,segments) VALUES('initialNightitem','initialNight','svc','NEW','{}','[]');
    INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,status,planned_start_time,planned_end_time)
      VALUES('initialNightB','2026-09-26','initialNight','night-other','QUEUED','2026-09-27 01:00+07','2026-09-27 01:30+07');
    UPDATE "TurnQueue" SET status='assigned',booking_item_ids=ARRAY['initialNightitem','night-other'] WHERE employee_id='initialNightB';`);
  await db.query(`SELECT dispatch_apply_edit('initialNight','DISPATCH',$1,'{}')`,[JSON.stringify({date:'2026-09-26',itemUpdates:[{id:nightId,options:{sequentialSlots:2,dispatchRevision:0},segments:[
    {id:'initialNight-a',ktvId:'initialNightA',sequenceSlot:1,startTime:'23:45',endTime:'00:15',duration:30},
    {id:'initialNight-b',ktvId:'initialNightB',sequenceSlot:2,startTime:'00:15',endTime:'00:45',duration:30}]}]})]);
  const nightPlan = (await db.query(`SELECT planned_start_time,planned_end_time FROM "KtvAssignments" WHERE employee_id='initialNightB' AND booking_item_id='initialNightitem'`)).rows[0];
  assert.equal(new Date(nightPlan.planned_start_time).toISOString(),'2026-09-26T17:15:00.000Z');
  assert.equal(new Date(nightPlan.planned_end_time).toISOString(),'2026-09-26T17:45:00.000Z');
  assert.equal((await db.query(`SELECT estimated_end_time FROM "TurnQueue" WHERE employee_id='initialNightB'`)).rows[0].estimated_end_time,'01:30:00');
  console.log('PASS initial B clock after midnight remains the next calendar day within the same booking service run');

  let id = await seed('pause');
  let item = await commit(id,{action:'PAUSE',employeeId:'pauseA'},at(10));
  assert.equal(item.status,'PAUSED'); assert.equal(employeeIsPaused(item,'pauseA'),true); assert.equal(employeeIsPaused(item,'pauseB'),false);
  assert.equal(item.segments[1].pauses,undefined);
  const pausedSnapshot = structuredClone(item);
  item = await commit(id,{action:'RESUME'},at(15));
  assert.equal(item.segments[0].actualStartTime,at(0)); assert.equal(workedMsOf(item.segments[0],at(20)),15*60000);
  await assert.rejects(commit(id,{action:'FINISH',targetSlots:[1]},at(20),pausedSnapshot),/bản lưu mới|thay đổi/);
  assert.equal((await row(id)).segments[0].actualEndTime,undefined);
  console.log('PASS 1/5 A pause/resume freezes own clock; B untouched; stale confirmation rejected');

  id = await seed('bpaused',true,true);
  const completedA = (await row(id)).segments[0];
  item = await commit(id,{action:'PAUSE',employeeId:'bpausedB'},at(40));
  assert.deepEqual(item.segments[0],completedA); assert.equal(employeeIsPaused(item,'bpausedA'),false); assert.equal(employeeIsPaused(item,'bpausedB'),true);
  item = await commit(id,{action:'FINISH',targetSlots:[2]},at(50));
  assert.equal(item.status,'CLEANING'); assert.equal(item.segments[1].actualEndTime,at(40)); assert.equal(item.segments[1].customCommissionDuration,10);
  assert.deepEqual(item.segments[0],completedA); assert.equal((await assignment('bpausedB',id)).status,'ACTIVE');
  console.log('PASS 2/5 A completed + B paused + finish only B: A intact; B ends at pause; handover assignment retained');

  id = await seed('cancelB',true,true);
  item = await commit(id,{action:'PAUSE'},at(40));
  const ownA = structuredClone(item.segments[0]);
  item = await commit(id,{action:'CANCEL',targetSlots:[2],cancelCredit:'NONE',reason:'Chỉ huỷ B'},at(50));
  assert.deepEqual(item.segments[0],ownA); assert.equal(item.segments[1].voided,true); assert.equal(item.segments[1].actualEndTime,at(40));
  assert.equal(item.status,'CLEANING'); assert.equal(sequentialSlotsComplete(item.options,item.segments),true);
  assert.equal(await punished('cancelBA'),false); assert.equal(await punished('cancelBB'),true);
  assert.equal((await assignment('cancelBA',id)).status,'ACTIVE'); assert.equal((await assignment('cancelBB',id)).status,'ACTIVE');
  assert.equal((await db.query('SELECT "totalAmount" FROM "Bookings" WHERE id=$1',['cancelB'])).rows[0].totalAmount,'100');
  await assert.rejects(db.query(`SELECT ktv_release_work_atomic('cancelB','cancelBB','[]'::jsonb,NULL)`), /photos|quota/);
  assert.equal((await assignment('cancelBB',id)).status,'ACTIVE');
  await db.query(`SELECT ktv_release_work_atomic('cancelB','cancelBB','["https://local.test/b.jpg"]'::jsonb,NULL)`);
  item = await row(id);
  assert.equal(item.status,'FEEDBACK'); assert.ok(item.segments[1].handoverTime);
  assert.deepEqual(item.segments[1].handoverPhotoUrls,['https://local.test/b.jpg']);
  assert.equal(item.segments[1].voided,true); assert.equal(item.segments[1].actualEndTime,at(40));
  assert.equal((await assignment('cancelBB',id)).status,'COMPLETED');
  assert.equal((await assignment('cancelBA',id)).status,'ACTIVE');
  await db.query(`SELECT ktv_release_work_atomic('cancelB','cancelBA','["https://local.test/a.jpg"]'::jsonb,NULL)`);
  assert.equal((await row(id)).status,'FEEDBACK');
  await assert.rejects(db.query(`SELECT dispatch_assign_sequential_slot_b('cancelB',$1,'cancelBB','2026-09-26T04:00:00Z',10,false)`,[id]),/đóng|kết thúc|trạng thái|thay đổi/i);
  console.log('PASS 3/5 cancel only B changes only B: A credit/assignment preserved; closure does not block completion');

  id = await seed('cancelBoth',true,true);
  const bothBefore = await row(id);
  await db.exec(`UPDATE "KtvAssignments" SET status='COMPLETED' WHERE employee_id='cancelBothA' AND booking_item_id='cancelBothitem';
    INSERT INTO "Bookings"(id,status) VALUES('new-active','IN_PROGRESS');
    INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,segment_id,status) VALUES('cancelBothA','2026-09-26','new-active','new-item','new-seg','ACTIVE');
    UPDATE "TurnQueue" SET current_order_id='new-active',booking_item_id='new-item',booking_item_ids=ARRAY['new-item'] WHERE employee_id='cancelBothA';`);
  item = await commit(id,{action:'CANCEL',targetSlots:[1,2],cancelCredit:'NONE'},at(40));
  assert.equal(item.status,'CANCELLED'); assert.equal(item.segments[0].actualEndTime,bothBefore.segments[0].actualEndTime);
  assert.equal(item.segments[0].voided,true); assert.equal(item.segments[1].voided,true);
  assert.equal(await punished('cancelBothA'),true); assert.equal(await punished('cancelBothB'),true);
  assert.equal((await db.query('SELECT current_order_id FROM "TurnQueue" WHERE employee_id=$1',['cancelBothA'])).rows[0].current_order_id,'new-active');
  assert.equal((await db.query('SELECT "totalAmount" FROM "Bookings" WHERE id=$1',['cancelBoth'])).rows[0].totalAmount,'0');
  await db.query(`SELECT ktv_release_work_atomic('cancelBoth','cancelBothB','["https://local.test/cancel.jpg"]'::jsonb,NULL)`);
  assert.equal((await row(id)).status,'CANCELLED');
  assert.equal((await assignment('cancelBothB',id)).status,'COMPLETED');
  assert.equal((await db.query('SELECT current_order_id FROM "TurnQueue" WHERE employee_id=$1',['cancelBothA'])).rows[0].current_order_id,'new-active');
  const creditId = await seed('creditBoth',true,true);
  const credited = await commit(creditId,{action:'CANCEL',targetSlots:[1,2],cancelCredit:'WORKED'},at(40));
  assert.equal(credited.status,'CANCELLED'); assert.equal(credited.segments[0].voided,undefined); assert.equal(await punished('creditBothA'),false);
  console.log('PASS 4/5 explicit cancel both includes completed A; original timestamps stay; credit choice honored; newer work untouched');

  id = await seed('swap',true,true);
  item = await commit(id,{action:'PAUSE'},at(40));
  const beforeSwap = structuredClone(item);
  await assert.rejects(commit(id,{action:'SWAP',targetSlots:[2],newKtvId:'MISSING',assignedMins:10,reason:'Đổi B'},at(45)),/Invalid replacement/);
  assert.deepEqual(await row(id),beforeSwap); assert.equal((await assignment('swapB',id)).status,'ACTIVE'); assert.equal(await punished('swapB'),false);
  await db.exec(`INSERT INTO "Staff"(id,status,work_type) VALUES('EXT_C','ĐANG LÀM','TYPE_C');`);
  item = await commit(id,{action:'SWAP',targetSlots:[2],newKtvId:'EXT_C',assignedMins:10,reason:'Đổi B'},at(45));
  assert.deepEqual(item.segments[0],beforeSwap.segments[0]);
  const replacement = item.segments.find(seg=>seg.ktvId==='EXT_C');
  assert.equal(replacement.sequenceSlot,2); assert.equal(replacement.duration,10); assert.equal(replacement.actualStartTime,undefined);
  assert.equal((await assignment('EXT_C',id)).segment_id,replacement.id); assert.equal((await assignment('swapB',id)).status,'CANCELLED');
  assert.equal(item.options.serviceNamesForKtvs.swapA,'Tên A riêng'); assert.equal(item.options.serviceNamesForKtvs.swapB,'Tên B riêng');
  assert.equal((await db.query('SELECT status FROM "TurnQueue" WHERE employee_id=$1',['EXT_C'])).rows[0].status,'assigned');
  await assert.rejects(db.query(`SELECT ktv_release_work_atomic('swap','swapB','["https://local.test/old.jpg"]'::jsonb,NULL)`), /No completed live work/);
  assert.equal(item.options.counterLog.at(-1).action,'SWAP_KTV'); assert.ok(item.options.dispatchHistory.at(-1).changes.length);
  const incompleteId = await seed('finishA');
  const onlyA = await commit(incompleteId,{action:'FINISH',targetSlots:[1]},at(10));
  assert.equal(onlyA.status,'IN_PROGRESS'); assert.equal(onlyA.segments[1].actualStartTime,undefined); assert.equal(onlyA.segments[1].actualEndTime,undefined); assert.equal(onlyA.segments[1].voided,undefined);
  assert.throws(()=>applySequentialLifecycle(onlyA,{action:'FINISH'},at(15)),/Chọn A/);
  console.log('PASS 5/5 replacement stays in B slot, own plan/no fake start; failed swap rolls back; finish only A leaves B pending; explicit scope required');
  const closedAId = await seed('closedAWait',false,false,false);
  await commit(closedAId,{action:'CANCEL',targetSlots:[1],cancelCredit:'NONE'},at(10));
  await db.exec(`INSERT INTO "TurnQueue"(employee_id,date,status) VALUES('closedAWaitB','2026-09-26','waiting');`);
  const addB = await db.query(`SELECT dispatch_assign_sequential_slot_b('closedAWait',$1,'closedAWaitB','2026-09-26T03:20:00Z',20,false) AS result`,[closedAId]);
  assert.equal(addB.rows[0].result.success,true);
  const afterClosedA = await row(closedAId);
  assert.equal(afterClosedA.segments[0].voided,true); assert.equal(afterClosedA.segments[0].actualEndTime,at(10));
  assert.equal(afterClosedA.segments.find(seg=>seg.sequenceSlot===2).duration,20);
  console.log('PASS cancel only A with B not yet assigned still permits later B assignment without reviving A');
  await db.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
