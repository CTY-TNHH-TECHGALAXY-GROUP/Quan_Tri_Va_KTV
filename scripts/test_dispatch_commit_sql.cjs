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
 '20260927120000_sequential_operational_consistency.sql','20260927150000_sequential_scoped_lifecycle.sql','20260927180000_unassign_unstarted_dispatch_staff.sql','20260927190000_sync_unstarted_dispatch_plan.sql','20260927200000_dispatch_form_commit.sql']) await db.exec(read('supabase/migrations/'+file));
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

 const commit=async(key,segments,revision=0,action='DRAFT',extra={}) => (await db.query('SELECT dispatch_commit_form($1,$2,$3,$4) AS r',[key,action,JSON.stringify({roomName:'R',bedId:'X',notes:'keep',...extra,itemUpdates:[{id:key+'item',roomName:'R',bedId:'X',technicianCodes:segments.filter(s=>!s.voided).map(s=>s.ktvId),segments,options:{sequentialSlots:2,dispatchRevision:revision,serviceNamesForKtvs:{[key+'A']:'Tên A mới',[key+'C']:'Tên C mới'},notesForKtvs:{}}}]}),JSON.stringify({id:'admin'})])).rows[0].r;
 const [a,b]=await seed('swap',false);
 await db.exec(`INSERT INTO "Staff"(id,status) VALUES('swapC','ĐANG LÀM'); INSERT INTO "TurnQueue"(employee_id,date,status) VALUES('swapC','2026-09-26','waiting');`);
 const c={...b,id:'swapc',ktvId:'swapC',startTime:'10:45',endTime:'11:30',duration:45};
 const saved=await commit('swap',[{...a,duration:45,endTime:'10:45'},c]);
 assert.equal(saved.success,true);assert.equal(saved.savedItems.length,1);
 const swapped=await row('swap');assert.equal(swapped.segments.find(s=>s.ktvId==='swapA').duration,45);
 assert.equal(swapped.segments.find(s=>s.ktvId==='swapB').voided,true);
 assert.equal(swapped.segments.find(s=>s.ktvId==='swapC').duration,45);
 assert.equal(swapped.options.serviceNamesForKtvs.swapC,'Tên C mới');
 assert.equal(saved.revisions.swapitem,swapped.options.dispatchRevision);
 assert.deepEqual(saved.savedItems[0].segments,swapped.segments);
 // A failure after a removal must roll back segments, assignment, queue, ledger and revisions.
 const [ra,rb]=await seed('rollback',false);
 await db.exec(`INSERT INTO "Staff"(id,status) VALUES('rollbackC','ĐANG LÀM'); INSERT INTO "TurnQueue"(employee_id,date,status) VALUES('rollbackC','2026-09-26','waiting');`);
 const snap=async key=>({item:await row(key),assignments:(await db.query('SELECT * FROM "KtvAssignments" WHERE booking_id=$1 ORDER BY employee_id',[key])).rows,ledger:(await db.query('SELECT * FROM "TurnLedger" WHERE booking_id=$1 ORDER BY employee_id',[key])).rows,queue:(await db.query('SELECT * FROM "TurnQueue" WHERE current_order_id=$1 ORDER BY employee_id',[key])).rows});
 const before=await snap('rollback');
 await assert.rejects(commit('rollback',[{...ra,duration:45,endTime:'10:45'},{...rb,id:'rollbackc',ktvId:'rollbackC'}]),/OVERLAP_CONFIRM_REQUIRED/);
 assert.deepEqual(await snap('rollback'),before);
 await assert.rejects(commit('rollback',[{...ra,endTime:'invalid',duration:45}]),/thời lượng/);
 assert.deepEqual(await snap('rollback'),before);
 const [startedA,waitingB]=await seed('started');const startedBefore=await snap('started');
 await assert.rejects(commit('started',[{...waitingB,sequenceSlot:1}]),/bắt đầu/);assert.deepEqual(await snap('started'),startedBefore);
 await assert.rejects(commit('started',[startedA,waitingB],99),/bản lưu mới/);assert.deepEqual(await snap('started'),startedBefore);
 // Existing ordinary A can update its unstarted plan and assign B in one user Save.
 const [oa,ob]=await seed('ordinary',false);
 await db.exec(`UPDATE "BookingItems" SET status='NEW' WHERE id='ordinaryitem'; UPDATE "BookingItems" SET options='{}',segments=jsonb_build_array((segments->0)-'sequenceSlot') WHERE id='ordinaryitem'; UPDATE "BookingItems" SET status='PREPARING' WHERE id='ordinaryitem'; DELETE FROM "KtvAssignments" WHERE employee_id='ordinaryB'; DELETE FROM "TurnLedger" WHERE employee_id='ordinaryB'; UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL WHERE employee_id='ordinaryB';`);
 const ordinary=await row('ordinary');
 const add=await commit('ordinary',[{...ordinary.segments[0],sequenceSlot:1,duration:45,endTime:'10:45'},{...ob,startTime:'10:45',endTime:'11:15'}],ordinary.options.dispatchRevision);
 assert.equal(add.success,true);assert.equal(add.savedItems[0].segments.filter(s=>!s.voided).length,2);
 assert.equal(add.savedItems[0].segments[0].duration,45);
 // Load the actual dispatch RPC instead of a permissive fixture to test NEW without DRAFT.
 await db.exec(`CREATE DOMAIN "BookingStatus" AS text; ALTER TABLE "KtvAssignments" ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(), ADD COLUMN IF NOT EXISTS sequence_no integer,ADD COLUMN IF NOT EXISTS priority integer,ADD COLUMN IF NOT EXISTS dispatch_source text;
 ALTER TABLE "TurnQueue" ADD COLUMN IF NOT EXISTS last_served_at timestamptz;`);
 await db.exec(read('supabase/migrations/20260830_add_dispatch_booking_guard.sql'));
 await db.exec(`INSERT INTO "Bookings"(id,status) VALUES('fresh','NEW');INSERT INTO "BookingItems"(id,"bookingId","serviceId",status,segments,options) VALUES('freshitem','fresh','svc','NEW','[]','{}');INSERT INTO "Staff"(id,status) VALUES('freshA','SẴN SÀNG');`);
 const fa={id:'fresha',ktvId:'freshA',sequenceSlot:1,roomId:'R',bedId:'X',startTime:'10:00',endTime:'10:30',duration:30};
 const dispatched=await commit('fresh',[fa],0,'DISPATCH',{date:'2026-09-26',status:'PREPARING',staffAssignments:[{ktvId:'freshA',bookingItemId:'freshitem',segmentId:fa.id,startTime:fa.startTime,endTime:fa.endTime,roomId:'R',bedId:'X'}]});
 assert.equal(dispatched.success,true);assert.equal(dispatched.savedItems[0].status,'PREPARING');
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM "KtvAssignments" WHERE booking_id='fresh' AND employee_id='freshA'`)).rows[0].n,1);
 const access=(await db.query(`SELECT has_function_privilege('service_role','dispatch_commit_form(text,text,jsonb,jsonb)','EXECUTE') AS service,has_function_privilege('authenticated','dispatch_commit_form(text,text,jsonb,jsonb)','EXECUTE') AS client`)).rows[0];
 assert.deepEqual(access,{service:true,client:false});await db.close();
 console.log('PASS atomic form commit: NEW direct Dispatch, live A plan + B assignment, replacement/removal rollback, started/stale guards, snapshots and service-role permissions');
})().catch(error=>{console.error(error);process.exitCode=1;});
