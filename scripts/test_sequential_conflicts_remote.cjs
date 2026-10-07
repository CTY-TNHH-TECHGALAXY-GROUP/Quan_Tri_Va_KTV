// Isolated TEST project. Sequential fixtures roll back; committed race fixtures are removed by exact ids.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Client} = require('pg');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname,'../.env.local')));
const ref='eknggruuiuadwldacpmb', url=new URL(env.DATABASE_URL);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,ref+'.supabase.co');
assert.ok(url.hostname==='db.'+ref+'.supabase.co'||decodeURIComponent(url.username).endsWith('.'+ref));
const client=()=>new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000,statement_timeout:12000,lock_timeout:6000});
const db=client(), left=client(), right=client();
const prefix='SEQ_CONFLICT_QA_'+process.pid+'_'+Date.now();
const staff=[prefix+'_A',prefix+'_B',prefix+'_C'];
const ids=Array.from({length:4},(_,i)=>prefix+'_'+i);
const findings=[], results=[];
let day;
const at=clock=>day+'T'+clock+':00+07:00';
const seg=(id,employee,start,end,duration,slot=1)=>({id,ktvId:employee,startTime:start,endTime:end,duration,sequenceSlot:slot,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1'});
const item=async(connection,id)=>(await connection.query('SELECT to_jsonb(i) AS value FROM "BookingItems" i WHERE id=$1',[id+'_ITEM'])).rows[0].value;
const apply=async(connection,id,action,payload)=>(await connection.query('SELECT dispatch_commit_form($1,$2,$3,$4) AS result',[id,action,JSON.stringify(payload),JSON.stringify({id:'SEQ_TEST_ADMIN'})])).rows[0].result;
const payload=(id,segments,options={})=>({date:day,status:'PREPARING',technicianCode:segments.map(s=>s.ktvId).join(' - '),bedId:'SEQ_TEST_BED_1',roomName:'TEST Phòng nối tiếp',
  itemUpdates:[{id:id+'_ITEM',status:'PREPARING',segments,options,technicianCodes:segments.map(s=>s.ktvId),bedId:'SEQ_TEST_BED_1',roomName:'TEST Phòng nối tiếp'}],
  staffAssignments:segments.map(s=>({ktvId:s.ktvId,bookingItemId:id+'_ITEM',segmentId:s.id,startTime:s.startTime,endTime:s.endTime,roomId:s.roomId,bedId:s.bedId,queuePos:999}))});
async function fixture(){
  for(const employee of staff){
    await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status) VALUES($1,$1,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`,[employee]);
    await db.query(`INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status) VALUES($1,$2,999,999,'waiting')`,[employee,day]);
  }
  for(const id of ids){
    await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount",status) VALUES($1,$1,$2,now(),'STANDARD_WALK_IN',300000,'NEW')`,[id,day]);
    await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,'SEQ_TEST_SVC_60',300000,'NEW','{}')`,[id+'_ITEM',id]);
  }
}
async function state(){
  // Exclude server timestamps; include all business writes that a failed save must undo.
  const rows=await db.query(`SELECT jsonb_build_object(
    'bookings',(SELECT jsonb_agg(to_jsonb(b)-'updatedAt' ORDER BY id) FROM "Bookings" b WHERE id=ANY($1)),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "BookingItems" i WHERE "bookingId"=ANY($1)),
    'assignments',(SELECT jsonb_agg(to_jsonb(a)-'updated_at' ORDER BY id) FROM "KtvAssignments" a WHERE booking_id=ANY($1)),
    'queue',(SELECT jsonb_agg(to_jsonb(t) ORDER BY employee_id) FROM "TurnQueue" t WHERE employee_id=ANY($2)),
    'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY booking_id,employee_id) FROM "TurnLedger" l WHERE booking_id=ANY($1))) AS value`,[ids,staff]);
  return rows.rows[0].value;
}
async function reject(operation,pattern){
  const before=await state();
  await db.query('SAVEPOINT rejected');
  try{await assert.rejects(async()=>{await operation();await db.query('SET CONSTRAINTS ALL IMMEDIATE');},pattern);}finally{await db.query('ROLLBACK TO SAVEPOINT rejected');await db.query('RELEASE SAVEPOINT rejected');}
  assert.deepEqual(await state(),before,'rejected operation must leave no partial business writes');
}
const assign=(connection,id,employee,clock='10:30',minutes=30,confirm=false)=>connection.query('SELECT dispatch_assign_sequential_slot_b($1,$2,$3,$4,$5,$6) AS result',[id,id+'_ITEM',employee,at(clock),minutes,confirm]);
async function start(id,employee){
  const old=await item(db,id),booking=(await db.query('SELECT to_jsonb(b) AS value FROM "Bookings" b WHERE id=$1',[id])).rows[0].value;
  const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
  const segments=structuredClone(old.segments);segments[0].actualStartTime=at('10:00');
  await db.query(`SELECT ktv_start_service_atomic($1,$2,$3,'[]',$4,$5,$6,$7,$8)`,[id,
    JSON.stringify(pick(booking,['id','status','rating','timeStart'])),
    JSON.stringify([pick(old,['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'])]),
    JSON.stringify([{id:old.id,status:'IN_PROGRESS',segments}]),employee,segments[0].id,at('10:00'),
    JSON.stringify({status:'working',current_order_id:id,booking_item_id:old.id,booking_item_ids:[old.id],start_time:'10:00',estimated_end_time:'11:00'})]);
}
async function check(label,run){
  await db.query('BEGIN');
  try{await fixture();await run();await db.query('SET CONSTRAINTS ALL IMMEDIATE');results.push({label,pass:true});console.log('PASS '+label);}
  catch(error){findings.push({label,error:error.message});results.push({label,pass:false});console.log('FAIL '+label+': '+error.message);}
  finally{await db.query('ROLLBACK');}
}
async function cleanup(){
  await db.query('BEGIN');
  try{
    await db.query('DELETE FROM "TurnLedger" WHERE booking_id=ANY($1)',[ids]);
    await db.query('DELETE FROM "TurnQueue" WHERE employee_id=ANY($1)',[staff]);
    await db.query('DELETE FROM "Bookings" WHERE id=ANY($1)',[ids]);
    await db.query('DELETE FROM "Staff" WHERE id=ANY($1)',[staff]);
    await db.query('COMMIT');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Bookings" WHERE id=ANY($1)',[ids])).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "KtvAssignments" WHERE booking_id=ANY($1)',[ids])).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Staff" WHERE id=ANY($1)',[staff])).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "TurnQueue" WHERE employee_id=ANY($1)',[staff])).rows[0].n,0);
  }catch(error){await db.query('ROLLBACK');throw error;}
}
async function waitForLock(pid){
  for(let i=0;i<60;i++){
    const row=(await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
    if(row?.wait_event_type==='Lock')return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Second connection did not actually wait on the first transaction');
}
async function race(label,setup,first,second,verify){
  let pending;
  try{
    await db.query('BEGIN');await fixture();await setup();await db.query('COMMIT');
    await left.query('BEGIN');await first();
    // Supabase transaction pooler can switch backends between standalone queries.
    await right.query('BEGIN');
    const pid=(await right.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending=second().then(value=>({value}),error=>({error}));
    await waitForLock(pid);await left.query('COMMIT');
    const outcome=await pending;
    if(outcome.error)await right.query('ROLLBACK');
    else try{await right.query('COMMIT');}catch(error){outcome.error=error;await right.query('ROLLBACK');}
    await verify(outcome);
    results.push({label,pass:true});console.log('PASS '+label);
  }catch(error){findings.push({label,error:error.message});results.push({label,pass:false});console.log('FAIL '+label+': '+error.message);}
  finally{await left.query('ROLLBACK');if(pending)await pending;await right.query('ROLLBACK');await db.query('ROLLBACK');await cleanup();}
}
async function main(){
  await Promise.all([db.connect(),left.connect(),right.connect()]);
  try{
    day=(await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day")).rows[0].day;
    const [a,b,c]=staff,[one,two]=ids;
    await check('two NEW orders with the same KTV and overlapping plans must reject the second',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','11:00',60)]));
      await reject(()=>apply(db,two,'DISPATCH',payload(two,[seg('b',a,'10:30','11:30',60)])),/chồng|overlap|trùng|phân công/i);
    });
    await check('stale waiting queue must not silently complete an assignment still running',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','11:00',60)]));
      await start(one,a);
      await db.query(`UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL WHERE employee_id=$1`,[a]);
      await reject(()=>apply(db,two,'DISPATCH',payload(two,[seg('b',a,'10:30','11:30',60)])),/đang làm|chưa kết thúc|chồng|overlap|trùng|phân công/i);
      assert.equal((await db.query('SELECT status FROM "KtvAssignments" WHERE booking_id=$1',[one])).rows[0].status,'ACTIVE');
    });
    await check('two services in one booking cannot use the same KTV at overlapping times',async()=>{
      const p=payload(one,[seg('a',a,'10:00','11:00',60)]),q=payload(two,[seg('b',a,'10:30','11:30',60)]);
      await db.query('UPDATE "BookingItems" SET "bookingId"=$2 WHERE id=$1',[two+'_ITEM',one]);
      const merged={...p,itemUpdates:[...p.itemUpdates,...q.itemUpdates],staffAssignments:[...p.staffAssignments,...q.staffAssignments]};
      await reject(()=>apply(db,one,'DISPATCH',merged),/chồng|overlap|trùng|phân công/i);
    });
    await check('editing a queued plan into another queued plan must reject',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'09:00','10:00',60)]));
      await apply(db,two,'DISPATCH',payload(two,[seg('b',a,'11:00','12:00',60)]));
      await apply(db,ids[2],'DISPATCH',payload(ids[2],[seg('c',a,'13:00','14:00',60)]));
      const old=await item(db,ids[2]);
      await reject(()=>apply(db,ids[2],'DRAFT',{itemUpdates:[{id:old.id,segments:[seg('c',a,'11:30','12:30',60)],options:old.options}]}),/chồng|overlap|trùng/i);
    });
    await check('valid back-to-back plans remain allowed with one ACTIVE and one QUEUED',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','11:00',60)]));
      await apply(db,two,'DISPATCH',payload(two,[seg('b',a,'11:00','12:00',60)]));
      assert.deepEqual((await db.query('SELECT status FROM "KtvAssignments" WHERE employee_id=$1 ORDER BY planned_start_time',[a])).rows.map(r=>r.status),['ACTIVE','QUEUED']);
    });
    await check('B before A ends requires confirmation and writes nothing',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','10:30',30)],{sequentialSlots:2}));
      const before=await state(),r=(await assign(db,one,b,'10:29')).rows[0].result;
      assert.equal(r.code,'OVERLAP_CONFIRM_REQUIRED');assert.deepEqual(await state(),before);
      assert.equal((await assign(db,one,b,'10:30')).rows[0].result.success,true);
    });
    await check('confirmed A/B overlap never permits B to overlap another order',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','10:30',30)],{sequentialSlots:2}));
      await apply(db,two,'DISPATCH',payload(two,[seg('b',b,'10:00','11:00',60)]));
      await reject(()=>assign(db,one,b,'10:15',30,true),/không còn rảnh|phân công|overlap/i);
    });
    await check('B cannot be A, absent from queue, off-duty, or assigned to the wrong day',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','10:30',30)],{sequentialSlots:2}));
      await reject(()=>assign(db,one,a),/Không thể gán B/);
      await db.query('DELETE FROM "TurnQueue" WHERE employee_id=$1',[b]);
      await reject(()=>assign(db,one,b),/không còn rảnh/);
      await db.query(`UPDATE "TurnQueue" SET status='off' WHERE employee_id=$1`,[c]);
      await reject(()=>assign(db,one,c),/không còn rảnh/);
      await reject(()=>db.query('SELECT dispatch_assign_sequential_slot_b($1,$2,$3,$4::timestamptz+interval \'1 day\',30,false)',[one,one+'_ITEM',c,at('10:30')]),/service day/);
    });
    await check('invalid duration, clock, duplicate segments and duplicate items roll back',async()=>{
      const good=seg('a',a,'10:00','10:30',30);
      for(const s of [{...good,duration:0},{...good,duration:601},{...good,startTime:'25:00'}])
        await reject(()=>apply(db,one,'DRAFT',{itemUpdates:[{id:one+'_ITEM',segments:[s],options:{}}]}),/không hợp lệ/i);
      await reject(()=>apply(db,one,'DRAFT',{itemUpdates:[{id:one+'_ITEM',segments:[good,good],options:{}}]}),/không hợp lệ/i);
      const edit={id:one+'_ITEM',segments:[good],options:{}};
      await reject(()=>apply(db,one,'DRAFT',{itemUpdates:[edit,edit]}),/Trùng dịch vụ/);
    });
    await check('foreign item, stale sibling and wrong booking day cannot partially save',async()=>{
      await apply(db,one,'DRAFT',{itemUpdates:[{id:one+'_ITEM',segments:[seg('a',a,'10:00','10:30',30)],options:{}}]});
      await reject(()=>apply(db,one,'DRAFT',{itemUpdates:[{id:two+'_ITEM',segments:[],options:{}}]}),/bản lưu mới|thuộc đơn/);
      const old=await item(db,one);
      await reject(()=>apply(db,one,'DRAFT',{date:'2026-01-01',itemUpdates:[{id:old.id,segments:old.segments,options:old.options}]}),/service day/);
      await reject(()=>apply(db,one,'DRAFT',{itemUpdates:[{id:old.id,segments:[],options:{dispatchRevision:0}}]}),/bản lưu mới/);
    });
    await check('midnight B retains next-day timestamp and positive duration',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'23:45','00:15',30)],{sequentialSlots:2}));
      const r=(await db.query('SELECT dispatch_assign_sequential_slot_b($1,$2,$3,$4::timestamptz+interval \'1 day\',30,false) AS result',[one,one+'_ITEM',b,at('00:15')])).rows[0].result;
      assert.equal(r.success,true);
      const rows=(await db.query('SELECT planned_start_time,planned_end_time FROM "KtvAssignments" WHERE booking_id=$1 ORDER BY planned_start_time',[one])).rows;
      assert.equal(+new Date(rows[0].planned_end_time),+new Date(rows[1].planned_start_time));
      assert.ok(rows.every(r=>+new Date(r.planned_end_time)-new Date(r.planned_start_time)===1800000));
    });
    await race('two simultaneous stale saves: one commit, one rejection, retry succeeds',async()=>{},
      ()=>apply(left,one,'DRAFT',{itemUpdates:[{id:one+'_ITEM',segments:[seg('a',a,'10:00','10:30',30)],options:{}}]}),
      ()=>apply(right,one,'DRAFT',{itemUpdates:[{id:one+'_ITEM',segments:[seg('b',b,'11:00','11:30',30)],options:{}}]}),
      async outcome=>{assert.match(outcome.error?.message||'',/bản lưu mới/);let saved=await item(db,one);assert.equal(saved.segments[0].ktvId,a);
        await apply(right,one,'DRAFT',{itemUpdates:[{id:saved.id,segments:[seg('b',b,'11:00','11:30',30)],options:saved.options}]});saved=await item(db,one);assert.equal(saved.segments[0].ktvId,b);});
    await race('two bookings race for one B: one assignment, loser unchanged',async()=>{
      await apply(db,one,'DISPATCH',payload(one,[seg('a',a,'10:00','10:30',30)],{sequentialSlots:2}));
      await apply(db,two,'DISPATCH',payload(two,[seg('c',c,'10:00','10:30',30)],{sequentialSlots:2}));
    },()=>assign(left,one,b),()=>assign(right,two,b),async outcome=>{
      assert.match(outcome.error?.message||'',/không còn rảnh|phân công/);
      assert.equal((await item(db,two)).segments.filter(s=>s.sequenceSlot===2&&!s.voided).length,0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM "KtvAssignments" WHERE employee_id=$1',[b])).rows[0].n,1);
    });
    await race('two simultaneous DISPATCH clicks: no duplicate assignment or ledger',async()=>{},
      ()=>apply(left,one,'DISPATCH',payload(one,[seg('a',a,'10:00','11:00',60)])),
      ()=>apply(right,one,'DISPATCH',payload(one,[seg('a',a,'10:00','11:00',60)])),async outcome=>{
        assert.match(outcome.error?.message||'',/bản lưu mới/);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM "KtvAssignments" WHERE booking_id=$1',[one])).rows[0].n,1);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM "TurnLedger" WHERE booking_id=$1',[one])).rows[0].n,1);
      });
    // Hold only a QUEUED assignment open: this exercises the exclusion index,
    // rather than the existing unique ACTIVE index or a shared booking row lock.
    await race('two concurrent queued schedules cannot commit overlapping KTV time',async()=>{
      await apply(db,ids[2],'DISPATCH',payload(ids[2],[seg('active',a,'09:00','10:00',60)]));
      await apply(db,one,'DISPATCH',payload(one,[seg('left',a,'11:00','12:00',60)]));
      await apply(db,two,'DISPATCH',payload(two,[seg('right',a,'13:00','14:00',60)]));
    },async()=>{
      const saved=await item(left,one);
      await apply(left,one,'DRAFT',{itemUpdates:[{id:saved.id,segments:[seg('left',a,'15:00','16:00',60)],options:saved.options}]});
      await left.query('SET CONSTRAINTS ALL IMMEDIATE');
    },async()=>{
      const saved=await item(right,two);
      await apply(right,two,'DRAFT',{itemUpdates:[{id:saved.id,segments:[seg('right',a,'15:30','16:30',60)],options:saved.options}]});
      await right.query('SET CONSTRAINTS ALL IMMEDIATE');
    },async outcome=>{
      assert.equal(outcome.error?.code,'23P01');
      assert.equal((await item(db,two)).segments[0].startTime,'13:00');
      assert.equal((await item(db,one)).segments[0].startTime,'15:00');
      const rows=(await db.query('SELECT status,planned_start_time,planned_end_time FROM "KtvAssignments" WHERE employee_id=$1 ORDER BY planned_start_time',[a])).rows;
      assert.equal(rows.filter(r=>r.status==='ACTIVE').length,1);
      assert.ok(rows.every((r,i)=>i===0||+new Date(rows[i-1].planned_end_time)<=+new Date(r.planned_start_time)));
    });
    const report={day,project:ref,results,findings,cleanup:'verified',scope:'real PostgreSQL RPCs and two-connection races; no browser UI checks'};
    fs.writeFileSync(path.join(__dirname,'../_plans/sequential_conflicts_remote_results_20260928.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`${results.filter(r=>r.pass).length}/${results.length} checks passed; ${findings.length} findings; race fixtures removed`);
    if(findings.length)process.exitCode=1;
  }finally{await Promise.all([db.end(),left.end(),right.end()]);}
}
main().catch(error=>{console.error('FAILED:',error.message);process.exitCode=1;});
