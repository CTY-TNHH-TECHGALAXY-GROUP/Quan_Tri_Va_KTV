const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('pglite-2');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
(async()=>{
 const db=new PGlite();
 await db.exec(read('scripts/test_sequential_deep_fixes.cjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
 await db.exec(`ALTER TABLE "Bookings" ADD COLUMN "totalAmount" numeric DEFAULT 100,ADD COLUMN "technicianCode" text,ADD COLUMN "bedId" text,ADD COLUMN "roomName" text,ADD COLUMN notes text;
 ALTER TABLE "BookingItems" ADD COLUMN "pauseStart" timestamptz,ADD COLUMN price numeric DEFAULT 100,ADD COLUMN quantity numeric DEFAULT 1;
 ALTER TABLE "Services" ADD COLUMN duration numeric DEFAULT 60;ALTER TABLE "Staff" ADD COLUMN work_type text DEFAULT 'TYPE_A';ALTER TABLE "TurnLedger" ADD COLUMN is_punished boolean DEFAULT false;`);
 const unwrap=read('supabase/migrations/20260914120000_auto_complete_feedback_after_5m.sql');const start=unwrap.indexOf('CREATE OR REPLACE FUNCTION jsonb_unwrap_string(');
 await db.exec(unwrap.slice(start,unwrap.indexOf('$$;',start)+3));
 for(const file of ['20260925120000_live_sequential_handoff.sql','20260926120000_dispatch_edit_history.sql','20260926140000_ktv_finish_service_atomic.sql',
 '20260927120000_sequential_operational_consistency.sql','20260927150000_sequential_scoped_lifecycle.sql','20260927180000_unassign_unstarted_dispatch_staff.sql','20260927190000_sync_unstarted_dispatch_plan.sql']) await db.exec(read('supabase/migrations/'+file));
 const row=async key=>(await db.query('SELECT * FROM "BookingItems" WHERE id=$1',[key+'item'])).rows[0];
 async function seed(key,started=true){
  const a={id:key+'a',ktvId:key+'A',sequenceSlot:1,roomId:'R',bedId:'X',startTime:'10:00',endTime:'10:30',duration:30,...(started?{actualStartTime:'2026-09-26T03:00:00Z'}:{})};
  const b={id:key+'b',ktvId:key+'B',sequenceSlot:2,roomId:'R',bedId:'X',startTime:'10:30',endTime:'11:00',duration:30};
  await db.query(`INSERT INTO "Bookings"(id,status) VALUES($1,'IN_PROGRESS');`,[key]);
  await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",status,segments,options) VALUES($1,$2,'svc',$3,$4,'{"sequentialSlots":2,"dispatchRevision":0}')`,[key+'item',key,started?'IN_PROGRESS':'PREPARING',JSON.stringify([a,b])]);
  for(const seg of [a,b]){
   await db.query(`INSERT INTO "Staff"(id,status) VALUES($1,'ĐANG LÀM');`,[seg.ktvId]);
   await db.query(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,segment_id,planned_start_time,planned_end_time,status) VALUES($1,'2026-09-26',$2,$3,$4,$5,$6,'ACTIVE')`,[seg.ktvId,key,key+'item',seg.id,'2026-09-26T'+(seg.sequenceSlot===1?'03:00':'03:30')+':00Z','2026-09-26T'+(seg.sequenceSlot===1?'03:30':'04:00')+':00Z']);
   await db.query(`INSERT INTO "TurnQueue"(employee_id,date,status,current_order_id,booking_item_id,booking_item_ids) VALUES($1,'2026-09-26','assigned',$2,$3,ARRAY[$3]::text[])`,[seg.ktvId,key,key+'item']);
   await db.query(`INSERT INTO "TurnLedger"(date,booking_id,employee_id) VALUES('2026-09-26',$1,$2)`,[key,seg.ktvId]);
  }
  return [a,b];
 }
 const remove=async(key,staff,revision=0)=>(await db.query('SELECT dispatch_unassign_unstarted_staff($1,$2,$3,$4,$5) AS r',[key,key+'item',key+staff,revision,JSON.stringify({id:'admin'})])).rows[0].r;
 const [a,b]=await seed('removeB');
 const result=await remove('removeB','B');assert.equal(result.success,true);
 const after=await row('removeB');assert.deepEqual(after.segments[0],a);assert.equal(after.segments[1].voided,true);assert.equal(after.options.closedSequentialSlots,undefined);
 assert.equal((await db.query(`SELECT status FROM "KtvAssignments" WHERE employee_id='removeBB'`)).rows[0].status,'CANCELLED');
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM "TurnLedger" WHERE employee_id='removeBB'`)).rows[0].n,0);
 await db.exec(`INSERT INTO "Staff"(id,status) VALUES('removeBC','ĐANG LÀM');INSERT INTO "TurnQueue"(employee_id,date,status) VALUES('removeBC','2026-09-26','waiting');`);
 const assigned=(await db.query(`SELECT dispatch_apply_edit($1,'ASSIGN_B',$2,'{}') AS r`,['removeB',JSON.stringify({itemId:'removeBitem',toKtvId:'removeBC',plannedStartAt:'2026-09-26T03:30:00Z',durationMinutes:45,expectedRevision:result.revision})])).rows[0].r;
 assert.equal(assigned.success,true);assert.equal((await row('removeB')).segments.find(s=>s.ktvId==='removeBC').duration,45);
 await seed('removeA',false);await remove('removeA','A');const swapped=await row('removeA');assert.equal(swapped.segments[0].voided,true);assert.equal(swapped.segments[1].sequenceSlot,1);
 await seed('locked');const before=await row('locked');await assert.rejects(remove('locked','A'),/bắt đầu/);assert.deepEqual(await row('locked'),before);
 await assert.rejects(remove('locked','B',99),/bản lưu mới/);assert.deepEqual(await row('locked'),before);
 const [pa,pb]=await seed('plan',false);
 const edit={id:'planitem',segments:[{...pa,duration:45,endTime:'10:45'},{...pb,startTime:'10:45',endTime:'11:30',duration:45}],options:{sequentialSlots:2,dispatchRevision:0}};
 await db.query(`SELECT dispatch_apply_edit('plan','DRAFT',$1,'{}')`,[JSON.stringify({itemUpdates:[edit]})]);
 const planned=await row('plan');assert.equal(planned.segments[0].duration,45);assert.equal(planned.segments[1].duration,45);
 const own=(await db.query(`SELECT EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS n FROM "KtvAssignments" WHERE booking_id='plan' ORDER BY employee_id`)).rows;
 assert.deepEqual(own.map(r=>Number(r.n)),[45,45]);
 const failed={...edit,segments:[{...planned.segments[0],duration:60,endTime:'11:00'},planned.segments[1]],options:planned.options};
 await assert.rejects(db.query(`SELECT dispatch_apply_edit('plan','DRAFT',$1,'{}')`,[JSON.stringify({itemUpdates:[failed]})]),/OVERLAP_CONFIRM_REQUIRED/);
 assert.deepEqual(await row('plan'),planned,'overlap cancellation rolls back both plan changes');
 const bulkBefore=await row('locked');
 await assert.rejects(db.query('SELECT dispatch_unassign_unstarted_staffs($1,$2,$3,0,$4)',['locked','lockeditem',['lockedB','lockedA'],'{}']),/bắt đầu/);
 assert.deepEqual(await row('locked'),bulkBefore,'a failed multi-row removal rolls back earlier removals');
 await seed('normal',false);await db.exec(`UPDATE "BookingItems" SET status='NEW' WHERE id='normalitem';UPDATE "BookingItems" SET options='{}',segments=jsonb_build_array((segments->0)-'sequenceSlot') WHERE id='normalitem';UPDATE "BookingItems" SET status='PREPARING' WHERE id='normalitem';`);
 // Store a non-sequential single-row plan and verify the DRAFT trigger keeps its assignment clock aligned.
 const normal=await row('normal');normal.segments=normal.segments.map(seg=>({...seg,startTime:'10:00',endTime:'10:20',duration:20}));
 const normalSaved=await row('normal');
 await db.query(`SELECT dispatch_apply_edit('normal','DRAFT',$1,'{}')`,[JSON.stringify({itemUpdates:[{id:'normalitem',segments:normal.segments,options:normalSaved.options}]})]);
 assert.equal(Number((await db.query(`SELECT EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS n FROM "KtvAssignments" WHERE employee_id='normalA'`)).rows[0].n),20);
 const access=(await db.query(`SELECT has_function_privilege('service_role','dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb)','EXECUTE') AS service,has_function_privilege('authenticated','dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb)','EXECUTE') AS client`)).rows[0];
 assert.deepEqual(access,{service:true,client:false});await db.close();
 console.log('PASS SQL: remove/reassign B, remove unstarted A, started/stale guards, edit unstarted A/B plans atomically, overlap rollback and RPC permissions');
})().catch(error=>{console.error(error);process.exitCode=1;});
