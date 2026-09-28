// Isolated TEST orders. Each case runs against real PostgreSQL and rolls back.
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
const a='SEQ_QA_10_A', b='SEQ_QA_10_B', c='SEQ_QA_10_C';
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
    for(let n=1;n<=12;n++) {
      bid='SEQ_QA_10_CASE_'+n;iid=bid+'_ITEM';
      await db.query('BEGIN');
      try {
        if(n===11) await db.query(fs.readFileSync(path.join(root,'supabase/migrations/20260928030000_adjust_running_sequential_pair.sql'),'utf8'));
        for (const employee of [a,b,c]) {
          await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status)
            VALUES($1,$1,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`,[employee]);
          await db.query(`INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status)
            VALUES($1,$2,999,999,'waiting')`,[employee,day]);
        }
        await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount") VALUES($1,$1,$2,now(),'STANDARD_WALK_IN',300000)`,[bid,day]);
        await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,$3,300000,'NEW','{}')`,[iid,bid,'SEQ_TEST_SVC_'+([1,6,7,11,12].includes(n)?90:60)]);
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
        } else if(n===5) {
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
        } else if(n===6) {
          const saved=await dispatch([seg('a',a,'15:20','16:20',60,1),seg('b',b,'16:20','16:50',30,2)]);
          assert.equal(saved.options.sequentialSlots,2);
          assert.deepEqual((await assignments()).map(p=>Number(p.minutes)).sort((x,y)=>x-y),[30,60]);
          assert.equal(ktvAssignedMinutes(saved,a,90),60);
          assert.equal(ktvAssignedMinutes(saved,b,90),30);
        } else if(n===7) {
          await dispatch([seg('a',a,'15:20','15:50',30,1)]);
          await start(a,'15:20');
          let saved=await item();
          const changeMinutes=async minutes=>{
            const segments=structuredClone(saved.segments);
            segments[0].duration=minutes;
            segments[0].endTime=minutes===60?'16:20':'16:50';
            await db.query('SELECT dispatch_commit_form($1,$2,$3,$4)',[bid,'DRAFT',
              JSON.stringify({itemUpdates:[{id:iid,segments,options:saved.options}]}),JSON.stringify({id:'SEQ_TEST_ADMIN'})]);
          };
          await changeMinutes(60);
          saved=await item();assert.ok(!saved.options.closedSequentialSlots?.includes(2));
          assert.equal(Number((await assignments()).find(p=>p.employee_id===a).minutes),60);
          await changeMinutes(90);
          saved=await item();assert.deepEqual(saved.options.closedSequentialSlots,[2]);
          assert.equal(Number((await assignments()).find(p=>p.employee_id===a).minutes),90);
        } else if(n===8) {
          const saved=await dispatch([seg('a',a,'23:45','00:15',30,1),seg('b',b,'00:15','00:45',30,2)]);
          const plans=await assignments();
          assert.equal(saved.segments.length,2);
          assert.ok(plans.every(p=>Number(p.minutes)===30));
          assert.equal(new Date(plans.find(p=>p.employee_id===b).planned_start_time).getTime(),new Date(plans.find(p=>p.employee_id===a).planned_end_time).getTime());
        } else if(n===9) {
          const segments=[seg('a',a,'15:20','15:50',30,1),seg('b',b,'15:50','16:20',30,2)];
          await db.query('SELECT dispatch_commit_form($1,$2,$3,$4)',[bid,'DRAFT',JSON.stringify({itemUpdates:[{id:iid,segments,options:{sequentialSlots:2},technicianCodes:[a,b]}]}),'{}']);
          let saved=await item();assert.equal(saved.status,'NEW');assert.equal((await assignments()).length,0);
          const payload={date:day,status:'PREPARING',technicianCode:a+' - '+b,bedId:'SEQ_TEST_BED_1',roomName:'TEST Phòng nối tiếp',
            itemUpdates:[{id:iid,status:'PREPARING',segments:saved.segments,options:saved.options,technicianCodes:[a,b],roomName:'TEST Phòng nối tiếp',bedId:'SEQ_TEST_BED_1'}],
            staffAssignments:segments.map(s=>({ktvId:s.ktvId,bookingItemId:iid,segmentId:s.id,startTime:s.startTime,endTime:s.endTime,roomId:s.roomId,bedId:s.bedId,queuePos:999}))};
          await db.query('SELECT dispatch_commit_form($1,$2,$3,$4)',[bid,'DISPATCH',JSON.stringify(payload),'{}']);
          saved=await item();assert.equal(saved.status,'PREPARING');assert.equal((await assignments()).length,2);
        } else if(n===12) {
          await dispatch([seg('a',a,'15:20','15:50',30,1),seg('b',b,'15:50','16:50',60,2)]);
          const before=await item(),segments=structuredClone(before.segments);
          const first=segments.find(s=>s.sequenceSlot===1),second=segments.find(s=>s.sequenceSlot===2);
          first.duration=45;first.endTime='16:05';
          second.startTime='16:05';second.duration=45;second.endTime='16:50';
          await db.query('SELECT dispatch_commit_form($1,$2,$3,$4)',[bid,'DRAFT',
            JSON.stringify({itemUpdates:[{id:iid,segments,options:before.options}]}),JSON.stringify({id:'SEQ_TEST_ADMIN'})]);
          const after=await item(),plans=await assignments();
          assert.equal(after.segments.find(s=>s.sequenceSlot===1).duration,45);
          assert.equal(after.segments.find(s=>s.sequenceSlot===2).startTime,'16:05');
          assert.equal(new Date(plans.find(p=>p.employee_id===b).planned_start_time).toISOString(),new Date(at('16:05')).toISOString());
        } else if(n===11) {
          await dispatch([seg('a',a,'15:20','15:50',30,1),seg('b',b,'15:50','16:50',60,2)]);
          await start(a,'15:20');
          const before=await item();
          await db.query('SAVEPOINT pair_conflict');
          const blockedBid=bid+'_BLOCK',blockedIid=blockedBid+'_ITEM';
          await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount") VALUES($1,$1,$2,now(),'STANDARD_WALK_IN',0)`,[blockedBid,day]);
          await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,'SEQ_TEST_SVC_60',0,'NEW','{}')`,[blockedIid,blockedBid]);
          await db.query(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,segment_id,planned_start_time,planned_end_time,room_id,bed_id,status,dispatch_source)
            VALUES($1,$2,$3,$4,'other',$5,$6,'OTHER_ROOM','OTHER_BED','QUEUED','TEST')`,[b,day,blockedBid,blockedIid,at('16:05'),at('16:20')]);
          await rejected(()=>db.query('SELECT dispatch_adjust_running_sequential_pair($1,$2,$3,$4,$5,$6,$7,$8)',
            [bid,iid,Number(before.options.dispatchRevision),45,'16:05',45,JSON.stringify({}),JSON.stringify({id:'SEQ_TEST_ADMIN'})]),/chồng giờ/);
          await db.query('ROLLBACK TO SAVEPOINT pair_conflict');await db.query('RELEASE SAVEPOINT pair_conflict');
          const changed=(await db.query('SELECT dispatch_adjust_running_sequential_pair($1,$2,$3,$4,$5,$6,$7,$8) AS result',
            [bid,iid,Number(before.options.dispatchRevision),45,'16:05',45,JSON.stringify({displayName:'Tên mới'}),JSON.stringify({id:'SEQ_TEST_ADMIN'})])).rows[0].result;
          assert.equal(changed.success,true);
          const after=await item(),plans=await assignments();
          assert.equal(after.segments.find(s=>s.sequenceSlot===1).duration,45);
          assert.equal(after.options.displayName,'Tên mới');
          assert.equal(after.segments.find(s=>s.sequenceSlot===2).startTime,'16:05');
          assert.equal(Number(plans.find(p=>p.employee_id===b).minutes),45);
          assert.equal(new Date(plans.find(p=>p.employee_id===b).planned_start_time).toISOString(),new Date(at('16:05')).toISOString());
          await rejected(()=>db.query('SELECT dispatch_adjust_running_sequential_pair($1,$2,$3,$4,$5,$6,$7,$8)',
            [bid,iid,Number(before.options.dispatchRevision),50,'16:10',40,JSON.stringify({}),JSON.stringify({id:'SEQ_TEST_ADMIN'})]),/Ca đã thay đổi/);
        } else {
          await dispatch([seg('a',a,'15:20','16:20',60)],false);
          const old=await item(),oldBooking=await booking(),segments=structuredClone(old.segments);
          segments[0].actualStartTime=at('15:20');
          await rejected(()=>db.query('SELECT ktv_start_service_atomic($1,$2,$3,\'[]\',$4,$5,$6,$7,$8)',
            [bid,JSON.stringify(pick(oldBooking,['id','status','rating','timeStart'])),
              JSON.stringify([pick(old,['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'])]),
              JSON.stringify([{id:iid,status:'IN_PROGRESS',segments}]),b,'a',at('15:20'),
              JSON.stringify({status:'working',current_order_id:bid,booking_item_id:iid,booking_item_ids:[iid]})]),/Invalid START target/);
          assert.equal((await item()).status,'PREPARING');
          assert.equal((await booking()).timeStart,null);
        }
        await db.query('SET CONSTRAINTS ALL IMMEDIATE');
        console.log('PASS '+n+'/12 '+['90 phút chia A45/B45','A60 sửa A30 rồi gán B30','A bắt đầu/tạm dừng/tiếp tục, gán B sau','đổi B→C→B, sửa giờ và chặn bản cũ','A xong, B tạm dừng/huỷ, bắt buộc bàn giao','90 phút chia A60/B30','A đang làm: 60/90 phút đóng B theo thời lượng dịch vụ','nối tiếp qua 00:00','lưu nháp A/B rồi điều phối','chặn KTV sai bắt đầu ca','A đang làm, B đã gán: đổi A30→45 và dời B','A chưa bắt đầu, B đã gán: đổi A30→45 và dời B'][n-1]);
      } finally { await db.query('ROLLBACK'); }
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "Bookings" WHERE id LIKE \'SEQ_QA_10_CASE_%\'')).rows[0].count,0);
    console.log('PASS all 12 real PostgreSQL checks; fixtures rolled back');
  } finally { await db.end(); }
}
main().catch(e=>{console.error('FAILED:',e.message);process.exitCode=1});
