// Validate the deployed shared DB constraint in local PostgreSQL WASM only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('pglite-2'),{btree_gist}=require('pglite-2/contrib/btree_gist');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
(async()=>{
  const db=new PGlite({extensions:{btree_gist}});
  await db.exec(read('scripts/test_sequential_deep_fixes.cjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  await db.exec(`CREATE TYPE "BookingStatus" AS ENUM ('NEW','WAITING','PREPARING','READY','IN_PROGRESS','PAUSED','FEEDBACK','DONE','CANCELLED','SPLIT','COMPLETED','CLEANING','waiting_rating');
    ALTER TABLE "Bookings" ADD COLUMN "technicianCode" text, ADD COLUMN "bedId" text, ADD COLUMN "roomName" text, ADD COLUMN notes text;
    ALTER TABLE "BookingItems" ADD COLUMN "pauseStart" timestamptz, ADD COLUMN price numeric DEFAULT 100, ADD COLUMN quantity numeric DEFAULT 1;
    ALTER TABLE "Services" ADD COLUMN duration numeric DEFAULT 60;
    ALTER TABLE "Staff" ADD COLUMN work_type text DEFAULT 'TYPE_A';
    ALTER TABLE "TurnLedger" ADD COLUMN is_punished boolean DEFAULT false;
    ALTER TABLE "TurnQueue" ADD COLUMN last_served_at timestamptz;
    ALTER TABLE "KtvAssignments" ADD COLUMN id uuid DEFAULT gen_random_uuid() PRIMARY KEY, ADD COLUMN priority integer DEFAULT 0, ADD COLUMN sequence_no integer DEFAULT 0;
    CREATE UNIQUE INDEX one_active ON "KtvAssignments"(employee_id,business_date) WHERE status='ACTIVE';`);
  const unwrap=read('supabase/migrations/20260914120000_auto_complete_feedback_after_5m.sql'),start=unwrap.indexOf('CREATE OR REPLACE FUNCTION jsonb_unwrap_string(');
  await db.exec(unwrap.slice(start,unwrap.indexOf('$$;',start)+3));
  for(const file of ['20260830_add_dispatch_booking_guard.sql','20260925120000_live_sequential_handoff.sql',
    '20260926120000_dispatch_edit_history.sql','20260926140000_ktv_finish_service_atomic.sql',
    '20260927120000_sequential_operational_consistency.sql','20260927150000_sequential_scoped_lifecycle.sql',
    '20260927180000_unassign_unstarted_dispatch_staff.sql','20260927190000_sync_unstarted_dispatch_plan.sql',
    '20260927200000_dispatch_form_commit.sql','20260927220000_extend_running_sequential_a.sql','20260927230000_adjust_running_sequential_duration.sql'])
    await db.exec(read('supabase/migrations/'+file));
  // Exercise the audited live entry points rather than relying only on migration files.
  for(const row of JSON.parse(read('_plans/sequential_schedule_functions_20260928.json')))
    await db.exec(row.definition);
  await db.exec(read('supabase/migrations/20260928020000_prevent_live_assignment_overlap.sql'));
  const ids=['one','two','three'];
  async function setup(){
    await db.exec(`INSERT INTO "Staff"(id,status) VALUES('A','ĐANG LÀM'),('B','ĐANG LÀM');
      INSERT INTO "TurnQueue"(employee_id,date,status) VALUES('A','2026-09-28','waiting'),('B','2026-09-28','waiting');`);
    for(const id of ids){
      await db.query(`INSERT INTO "Bookings"(id,status,"bookingDate") VALUES($1,'NEW','2026-09-28')`,[id]);
      await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",status,options,segments) VALUES($1,$2,'svc','NEW','{}','[]')`,[id+'item',id]);
    }
  }
  const seg=(id,employee,start,end,minutes)=>({id,ktvId:employee,startTime:start,endTime:end,duration:minutes,roomId:'R',bedId:'X'});
  const payload=(id,segments,options={})=>({date:'2026-09-28',status:'PREPARING',itemUpdates:[{id:id+'item',status:'PREPARING',segments,options,technicianCodes:segments.map(s=>s.ktvId)}],
    staffAssignments:segments.map(s=>({ktvId:s.ktvId,bookingItemId:id+'item',segmentId:s.id,startTime:s.startTime,endTime:s.endTime,roomId:'R',bedId:'X'}))});
  const apply=(id,action,p)=>db.query('SELECT dispatch_commit_form($1,$2,$3,\'{}\')',[id,action,JSON.stringify(p)]);
  const row=async id=>(await db.query('SELECT * FROM "BookingItems" WHERE id=$1',[id+'item'])).rows[0];
  let count=0;
  async function check(label,run){await db.exec('BEGIN');try{await setup();await run();count++;console.log('PASS '+label);}finally{await db.exec('ROLLBACK');}}
  async function rejected(operation){
    await db.exec('SAVEPOINT expected');
    try{await assert.rejects(async()=>{await operation();await db.exec('SET CONSTRAINTS ALL IMMEDIATE');},/ktv_assignments_no_live_overlap/);}
    finally{await db.exec('ROLLBACK TO SAVEPOINT expected; RELEASE SAVEPOINT expected');}
  }
  await check('NEW overlapping orders rejected; second order/ledger/queue changes roll back',async()=>{
    await apply('one','DISPATCH',payload('one',[seg('a','A','10:00','11:00',60)]));
    await rejected(()=>apply('two','DISPATCH',payload('two',[seg('b','A','10:30','11:30',60)])));
    assert.equal((await row('two')).status,'NEW');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM "TurnLedger" WHERE booking_id='two'`)).rows[0].n,0);
  });
  await check('stale waiting queue cannot retire actual running work; real finish can retire it',async()=>{
    await apply('one','DISPATCH',payload('one',[seg('a','A','10:00','11:00',60)]));
    const old=await row('one'),booking=(await db.query(`SELECT * FROM "Bookings" WHERE id='one'`)).rows[0];
    const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
    const started=[{...old.segments[0],actualStartTime:'2026-09-28T10:00:00+07:00'}];
    await db.query(`SELECT ktv_start_service_atomic($1,$2,$3,'[]',$4,'A','a',$5,$6)`,['one',
      JSON.stringify(pick(booking,['id','status','rating','timeStart'])),
      JSON.stringify([pick(old,['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'])]),
      JSON.stringify([{id:old.id,status:'IN_PROGRESS',segments:started}]),'2026-09-28T10:00:00+07:00',
      JSON.stringify({status:'working',current_order_id:'one',booking_item_id:old.id,booking_item_ids:[old.id]})]);
    await db.exec(`UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL WHERE employee_id='A'; SAVEPOINT running;`);
    try{await assert.rejects(apply('two','DISPATCH',payload('two',[seg('b','A','10:30','11:30',60)])),/KTV đang làm, chưa kết thúc/);}
    finally{await db.exec('ROLLBACK TO SAVEPOINT running; RELEASE SAVEPOINT running');}
    assert.equal((await db.query(`SELECT status FROM "KtvAssignments" WHERE booking_id='one'`)).rows[0].status,'ACTIVE');
    assert.equal((await row('two')).status,'NEW');
    await db.exec(`UPDATE "BookingItems" SET segments=jsonb_set(segments,'{0,actualEndTime}','"2026-09-28T11:00:00+07:00"') WHERE id='oneitem';
      UPDATE "KtvAssignments" SET status='COMPLETED' WHERE booking_id='one'; SET CONSTRAINTS ALL IMMEDIATE;`);
  });
  await check('same booking overlapping services rejected',async()=>{
    await db.exec(`UPDATE "BookingItems" SET "bookingId"='one' WHERE id='twoitem'`);
    const p=payload('one',[seg('a','A','10:00','11:00',60)]),q=payload('two',[seg('b','A','10:30','11:30',60)]);
    await rejected(()=>apply('one','DISPATCH',{...p,itemUpdates:[...p.itemUpdates,...q.itemUpdates],staffAssignments:[...p.staffAssignments,...q.staffAssignments]}));
  });
  await check('queued-to-queued overlap rejected; exact boundary accepted',async()=>{
    await apply('one','DISPATCH',payload('one',[seg('a','A','09:00','10:00',60)]));
    await apply('two','DISPATCH',payload('two',[seg('b','A','11:00','12:00',60)]));
    await apply('three','DISPATCH',payload('three',[seg('c','A','13:00','14:00',60)]));
    const old=await row('three');
    await rejected(()=>apply('three','DRAFT',{itemUpdates:[{id:old.id,segments:[seg('c','A','11:30','12:30',60)],options:old.options}]}));
    assert.deepEqual(await row('three'),old);
    await apply('three','DRAFT',{itemUpdates:[{id:old.id,segments:[seg('c','A','12:00','13:00',60)],options:old.options}]});
    await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
  });
  await check('midnight outer RPC repairs intermediate same-day timestamp before final constraint',async()=>{
    const a={...seg('a','A','23:45','00:15',30),sequenceSlot:1},b={...seg('b','B','00:15','00:45',30),sequenceSlot:2};
    await apply('one','DISPATCH',payload('one',[a,b],{sequentialSlots:2}));
    await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    const plans=(await db.query('SELECT planned_start_time,planned_end_time FROM "KtvAssignments" ORDER BY planned_start_time')).rows;
    assert.ok(plans.every(p=>+new Date(p.planned_end_time)-new Date(p.planned_start_time)===1800000));
    assert.equal(+new Date(plans[0].planned_end_time),+new Date(plans[1].planned_start_time));
  });
  await check('cancelled/completed plans free time; cross-date overlap still rejected',async()=>{
    await apply('one','DISPATCH',payload('one',[seg('a','A','10:00','11:00',60)]));
    await db.exec(`UPDATE "KtvAssignments" SET status='CANCELLED' WHERE booking_id='one';UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL WHERE employee_id='A'`);
    await apply('two','DISPATCH',payload('two',[seg('b','A','10:00','11:00',60)]));
    await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    await rejected(()=>db.exec(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,status,planned_start_time,planned_end_time)
      VALUES('A','2026-09-27','three','threeitem','QUEUED','2026-09-28T10:30:00+07:00','2026-09-28T11:30:00+07:00')`));
  });
  await check('null, zero, reversed and infinite final clocks rejected; temporary reversal allowed',async()=>{
    for(const [start,end] of [[null,'2026-09-28T11:00:00+07:00'],['2026-09-28T11:00:00+07:00',null],
      ['2026-09-28T11:00:00+07:00','2026-09-28T11:00:00+07:00'],['2026-09-28T11:00:00+07:00','2026-09-28T10:00:00+07:00'],['-infinity','infinity']]){
      await db.exec('SAVEPOINT invalid');
      try{await db.query(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,status,planned_start_time,planned_end_time) VALUES('A','2026-09-28','one','oneitem','ACTIVE',$1,$2)`,[start,end]);
        await assert.rejects(db.exec('SET CONSTRAINTS ALL IMMEDIATE'),/Giờ phân công không hợp lệ/);}
      finally{await db.exec('ROLLBACK TO SAVEPOINT invalid; RELEASE SAVEPOINT invalid');}
    }
    await db.exec(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,status,planned_start_time,planned_end_time)
      VALUES('A','2026-09-28','one','oneitem','ACTIVE','2026-09-28T23:45:00+07:00','2026-09-28T00:15:00+07:00');
      UPDATE "KtvAssignments" SET planned_end_time='2026-09-29T00:15:00+07:00' WHERE booking_id='one'; SET CONSTRAINTS ALL IMMEDIATE;`);
  });
  await db.close();console.log('PASS '+count+' local PostgreSQL assignment guard checks');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
