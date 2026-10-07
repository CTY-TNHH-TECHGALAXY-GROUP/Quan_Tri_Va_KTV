// Five real PostgreSQL checks. Each case rolls back, preserving the NEW UI demo orders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env.local')));
const ref = 'eknggruuiuadwldacpmb';
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
const dbUrl = new URL(env.DATABASE_URL);
assert.ok(dbUrl.hostname === 'db.' + ref + '.supabase.co' || decodeURIComponent(dbUrl.username).endsWith('.' + ref));
require('ts-node').register({project:path.join(__dirname,'qa/tsconfig.qa.json'),transpileOnly:true});
require('tsconfig-paths').register({baseUrl:root,paths:{'@/*':['./*']}});
const {applySequentialLifecycle} = require('../lib/sequential-lifecycle');
const {ktvAssignedMinutes} = require('../lib/ktvUtils');
const pick = (obj,keys) => Object.fromEntries(keys.map(k=>[k,obj[k]]));
const a='SEQ_TEST_A', b='SEQ_TEST_B', c='SEQ_TEST_C';
const db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000});
let bid,iid,day;
const at = clock => day+'T'+clock+':00+07:00';
const item = async () => (await db.query('SELECT to_jsonb(i) AS value FROM "BookingItems" i WHERE id=$1',[iid])).rows[0].value;
const booking = async () => (await db.query('SELECT to_jsonb(b) AS value FROM "Bookings" b WHERE id=$1',[bid])).rows[0].value;
const assignments = async () => (await db.query('SELECT employee_id,status,planned_start_time,planned_end_time,EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS minutes FROM "KtvAssignments" WHERE booking_item_id=$1',[iid])).rows;
const seg = (id,employee,start,end,minutes,slot) => ({id,ktvId:employee,startTime:start,endTime:end,duration:minutes,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1',...(slot?{sequenceSlot:slot}:{})});
async function dispatch(segments,sequential=true) {
  const saved=await item();
  const options={...saved.options,...(sequential?{sequentialSlots:2}:{}),serviceNamesForKtvs:{[a]:'Tên riêng A',[b]:'Tên riêng B'}};
  const payload={date:day,status:'PREPARING',technicianCode:segments.map(s=>s.ktvId).join(' - '),bedId:'SEQ_TEST_BED_1',roomName:'TEST Phòng nối tiếp',
    itemUpdates:[{id:iid,status:'PREPARING',segments,options,technicianCodes:segments.map(s=>s.ktvId),roomName:'TEST Phòng nối tiếp',bedId:'SEQ_TEST_BED_1'}],
    staffAssignments:segments.map(s=>({ktvId:s.ktvId,bookingItemId:iid,segmentId:s.id,startTime:s.startTime,endTime:s.endTime,roomId:s.roomId,bedId:s.bedId,queuePos:1}))};
  // Reproduce the catalogue-duration bug; the outer RPC must correct persisted B to 45.
  if (segments.length===2 && segments[1].duration===45) payload.staffAssignments[1].endTime='17:35';
  await db.query('SELECT dispatch_apply_edit($1,\'DISPATCH\',$2,\'{}\')',[bid,JSON.stringify(payload)]);
  return item();
}
async function assign(employee=b,clock='15:50',minutes=30) {
  const result=(await db.query('SELECT dispatch_assign_sequential_slot_b($1,$2,$3,$4,$5,false) AS result',[bid,iid,employee,at(clock),minutes])).rows[0].result;
  assert.equal(result.success,true,JSON.stringify(result)); return item();
}
async function lifecycle(request,clock,expected) {
  const old=expected||await item();
  const snapshot=pick(old,['id','bookingId','status','segments','options','pauseStart','timeEnd','technicianCodes']);
  const patch=applySequentialLifecycle(old,request,at(clock),{id:'SEQ_TEST_ADMIN',name:'TEST Admin'});
  await db.query('SELECT dispatch_sequential_lifecycle_atomic($1,$2,$3,$4,$5,\'{}\',$6)',[bid,iid,JSON.stringify(snapshot),JSON.stringify(patch),request.action,Number(old.options.dispatchRevision||0)]);
  return item();
}
async function start(employee,clock) {
  const old=await item(),oldBooking=await booking();
  const segments=structuredClone(old.segments), target=segments.find(s=>s.ktvId===employee&&!s.voided&&!s.actualEndTime);
  target.actualStartTime=at(clock);
  const snapshot=pick(old,['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId']);
  await db.query('SELECT ktv_start_service_atomic($1,$2,$3,\'[]\',$4,$5,$6,$7,$8)',[bid,JSON.stringify({...pick(oldBooking,['id','status','rating','timeStart'])}),JSON.stringify([snapshot]),
    JSON.stringify([{id:iid,status:'IN_PROGRESS',segments}]),employee,target.id,at(clock),JSON.stringify({status:'working',current_order_id:bid,booking_item_id:iid,booking_item_ids:[iid],start_time:clock,estimated_end_time:target.endTime})]);
  return item();
}
async function rejected(operation,pattern) {
  await db.query('SAVEPOINT expected_failure');
  try { await assert.rejects(operation,pattern); } finally { await db.query('ROLLBACK TO SAVEPOINT expected_failure'); await db.query('RELEASE SAVEPOINT expected_failure'); }
}
async function main() {
  await db.connect();
  try {
    day=(await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day")).rows[0].day;
    for(let n=1;n<=5;n++) {
      bid='SEQ_AUTO_CHECK_'+n;iid=bid+'_ITEM';
      await db.query('BEGIN');
      try {
        await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount") VALUES($1,$1,$2,now(),'STANDARD_WALK_IN',300000)`,[bid,day]);
        await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,$3,300000,'NEW','{}')`,[iid,bid,'SEQ_TEST_SVC_'+(n===1?90:60)]);
        if(n===1) {
          const saved=await dispatch([seg('a',a,'15:20','16:05',45,1),seg('b',b,'16:05','16:50',45,2)]);
          const plans=await assignments();assert.equal(plans.length,2);assert.ok(plans.every(p=>Number(p.minutes)===45));
          assert.equal(new Date(plans.find(p=>p.employee_id===b).planned_end_time).toISOString(),new Date(at('16:50')).toISOString());
          assert.equal(ktvAssignedMinutes(saved,a,90),45);assert.equal(ktvAssignedMinutes(saved,b,90),45);
        } else if(n===2) {
          await dispatch([seg('a',a,'15:20','16:20',60)],false);
          await dispatch([seg('a',a,'15:20','15:50',30)],false);
          await db.query('SELECT dispatch_enable_sequential_item($1,$2)',[bid,iid]);
          await assign();assert.ok((await assignments()).every(p=>Number(p.minutes)===30));
        } else if(n===3) {
          await dispatch([seg('a',a,'15:20','15:50',30,1)]);
          const started=await start(a,'15:20');assert.equal(started.segments.length,1);
          const paused=await lifecycle({action:'PAUSE',employeeId:a},'15:30');assert.equal(paused.status,'PAUSED');
          await lifecycle({action:'RESUME',employeeId:a},'15:35');
          const added=await assign();assert.equal(added.segments.find(s=>s.ktvId===a).actualStartTime,started.segments[0].actualStartTime);
          assert.equal(added.segments.find(s=>s.ktvId===b).actualStartTime,undefined);
        } else if(n===4) {
          await dispatch([seg('a',a,'15:20','15:50',30,1)]);
          await assign();await assign(c);let saved=await assign(b);
          assert.ok(saved.segments.some(s=>s.ktvId===c&&s.voided===true));
          for(const [minutes,name]of [[35,'B sửa 1'],[40,'B sửa 2']]) {
            const before=saved,segments=structuredClone(saved.segments),target=segments.find(s=>s.ktvId===b&&!s.voided);
            target.startTime='16:00';target.duration=minutes;target.endTime=minutes===35?'16:35':'16:40';
            const options={...saved.options,serviceNamesForKtvs:{...saved.options.serviceNamesForKtvs,[b]:name}};
            await db.query('SELECT dispatch_apply_edit($1,\'DISPATCH\',$2,\'{}\')',[bid,JSON.stringify({date:day,itemUpdates:[{id:iid,segments,options}]})]);
            saved=await item();assert.equal(saved.options.serviceNamesForKtvs[a],'Tên riêng A');assert.equal(saved.options.serviceNamesForKtvs[b],name);
            assert.equal(Number((await assignments()).find(p=>p.employee_id===b).minutes),minutes);
            assert.ok(saved.options.dispatchRevision>before.options.dispatchRevision);
            await rejected(()=>db.query('SELECT dispatch_apply_edit($1,\'DISPATCH\',$2,\'{}\')',[bid,JSON.stringify({date:day,itemUpdates:[{id:iid,segments:before.segments,options:before.options}]})]),/bản lưu mới|thay đổi/);
          }
        } else {
          await dispatch([seg('a',a,'15:20','15:50',30,1),seg('b',b,'15:50','16:20',30,2)]);
          await start(a,'15:20');const aDone=await lifecycle({action:'FINISH',targetSlots:[1]},'15:50');
          const preserved=structuredClone(aDone.segments[0]);await start(b,'15:50');
          await lifecycle({action:'PAUSE',employeeId:b},'16:00');
          const cancelled=await lifecycle({action:'CANCEL',targetSlots:[2],cancelCredit:'NONE'},'16:10');
          assert.deepEqual(cancelled.segments[0],preserved);assert.equal(cancelled.segments[1].voided,true);
          await rejected(()=>db.query('SELECT ktv_release_work_atomic($1,$2,\'[]\',NULL)',[bid,b]),/photos|quota/);
          await db.query('SELECT ktv_release_work_atomic($1,$2,$3,NULL)',[bid,b,JSON.stringify(['https://example.invalid/test-handover.jpg'])]);
          assert.equal((await assignments()).find(p=>p.employee_id===b).status,'COMPLETED');
          assert.deepEqual((await item()).segments[0],preserved);
        }
        console.log('PASS '+n+'/5 real test DB: '+['new A45/B45 and own duration','A60 changed to A30 then B30','A starts with empty B, pause/resume then assign B','B→C→B, edit twice, stale save rejected','A finished, B paused/cancelled, handover required'][n-1]);
      } finally { await db.query('ROLLBACK'); }
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "Bookings" WHERE id LIKE \'SEQ_AUTO_CHECK_%\'')).rows[0].count,0);
    console.log('PASS all 5 real PostgreSQL checks; fixtures rolled back, 5 NEW UI orders preserved');
  } finally { await db.end(); }
}
main().catch(e=>{console.error('FAILED:',e.message);process.exitCode=1});
