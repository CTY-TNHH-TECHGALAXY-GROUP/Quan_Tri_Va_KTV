// Proposal checks run candidates under /tmp, never a shared Supabase database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const candidate = '/tmp/sequential-deep-proposal-20260927';
const ts = require(path.resolve(root, '../../node_modules/typescript'));
const { PGlite } = require(path.resolve(root, '../../node_modules/pglite-2'));
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const exports = cache[file] = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(candidate, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function('require', 'exports', js)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, opts) => ({ body, status: opts.status }) } };
    if (name.includes('_shared/utils')) return {};
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(path.join(path.dirname(file),name)+'.ts');
    return require(name);
  }, exports);
  return exports;
}

async function main() {
  const utils = load('lib/ktvUtils.ts');
  assert.deepEqual(utils.parseKtvSegments('{}'), []);
  assert.deepEqual(utils.parseKtvSegments(JSON.stringify(JSON.stringify([{id:'seg'}, null, 1]))), [{id:'seg'}]);
  assert.equal(utils.ktvMetadataValue({ 'demo-b': 'Tên B đã lưu' }, 'DEMO-B'), 'Tên B đã lưu');
  assert.deepEqual(utils.ktvMetadataMap({ A:'Tên A', 'demo-b':'Tên B' }, [{ktvId:'A', serviceNameForKtv:'A mới'}], 'serviceNameForKtv'), {A:'A mới','demo-b':'Tên B'});
  assert.equal(utils.ktvMetadataValue(utils.ktvMetadataMap({ b:'B cũ' }, [{ktvId:'B', name:''}], 'name'),'B'), '');
  assert.equal(utils.sequentialClockAt('2026-09-26','23:50','00:10'), '2026-09-26T17:10:00.000Z');
  assert.equal(utils.sequentialClockAt('2026-09-26','23:50','23:55'), '2026-09-26T16:55:00.000Z');
  assert.throws(()=>utils.parseKtvSegments('{}',true),/không hợp lệ/);
  const React = require(path.resolve(root,'../../node_modules/react'));
  const {renderToStaticMarkup} = require(path.resolve(root,'../../node_modules/react-dom/server'));
  const screenSource=fs.readFileSync(path.join(candidate,'app/ktv/dashboard/_screens/ScreenTimer.tsx'),'utf8');
  const timelineCode=ts.transpileModule(screenSource.slice(screenSource.indexOf('export function WorkingTimeline'),screenSource.indexOf('export function ScreenTimer')),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const timelineExports={};
  new Function('exports','React','motion','roomLabel','CheckCircle','Clock',timelineCode)(timelineExports,React,{div:({children})=>React.createElement('div',null,children)},String,()=>null,()=>null);
  const timeline = renderToStaticMarkup(React.createElement(timelineExports.WorkingTimeline,{segments:[
    {id:'first',roomId:'R1',startTime:'10:00',endTime:'10:30',actualStartTime:'10:00',duration:30},
    {id:'second',roomId:'R2',startTime:'11:15',endTime:'11:45',actualStartTime:'11:00',duration:30}
  ],shouldMerge:false,activeIndex:1}));
  assert.ok(timeline.includes('11:15') && timeline.includes('11:45') && timeline.includes('Thực tế 11:00'));
  console.log('PASS 1/5 parser + independent metadata + midnight clock + actual WorkingTimeline keeps second saved plan/actual');

  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE "Bookings" (id text PRIMARY KEY, status text, rating numeric, "timeStart" timestamptz, "updatedAt" timestamptz,
      "bookingDate" timestamp without time zone DEFAULT '2026-09-26 10:00', "guestCount" integer, parent_booking_id text);
    CREATE TABLE "Services" (id text PRIMARY KEY, "nameVN" text, is_utility boolean);
    INSERT INTO "Services" VALUES ('svc','Massage',false);
    CREATE TABLE "BookingGuests" (id text PRIMARY KEY,booking_id text, rating numeric,guest_index integer,guest_label text,status text,bed_id text,room_id text,notes text,focus_area text);
    CREATE TABLE "BookingItems" (id text PRIMARY KEY,"bookingId" text,status text,"itemRating" numeric,guest_id text,options jsonb,
      handover_status text,handover_images jsonb,handover_skipped boolean,handover_submitted_at timestamptz,"serviceId" text,
      segments jsonb,"technicianCodes" text[],"timeEnd" timestamptz,"roomName" text,"bedId" text);
    CREATE TABLE "KtvAssignments" (employee_id text,business_date date,booking_id text,booking_item_id text,segment_id text,
      planned_start_time timestamptz,planned_end_time timestamptz,room_id text,bed_id text,status text,dispatch_source text,
      created_at timestamptz DEFAULT now(),updated_at timestamptz,UNIQUE(employee_id,booking_item_id));
    CREATE TABLE "TurnQueue" (employee_id text,date date,status text,current_order_id text,booking_item_id text,
      booking_item_ids text[],start_time time,estimated_end_time time,room_id text,bed_id text,queue_position integer,check_in_order integer,
      turns_completed integer,UNIQUE(employee_id,date));
    CREATE TABLE "TurnLedger" (date date,booking_id text,employee_id text,source text,UNIQUE(date,booking_id,employee_id));
    CREATE TABLE "Staff" (id text,status text);
    CREATE TABLE promotions (employee_id text,date date);
    CREATE FUNCTION promote_next_assignment(e text,d date) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO promotions VALUES(e,d); UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL WHERE employee_id=e AND date=d;
      RETURN '{"success":true}'; END $$;
    CREATE FUNCTION dispatch_confirm_booking(text,date,text,text,text,text,text,jsonb,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN RETURN '{"success":false,"error":"fixture dispatch refused"}'; END $$;
  `);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260926140000_ktv_finish_service_atomic.sql'),'utf8'));
  const legacyHelperSource=fs.readFileSync(path.join(root,'supabase/migrations/20260914120000_auto_complete_feedback_after_5m.sql'),'utf8');
  const helperStart=legacyHelperSource.indexOf('CREATE OR REPLACE FUNCTION jsonb_unwrap_string(');
  await db.exec(legacyHelperSource.slice(helperStart,legacyHelperSource.indexOf('$$;',helperStart)+3));
  await db.exec(fs.readFileSync(path.join(candidate,'supabase/migrations/20260927120000_sequential_operational_consistency.sql'),'utf8'));
  const row = async (table,id) => (await db.query(`SELECT * FROM "${table}" WHERE id=$1`,[id])).rows[0];
  const insert = async (id,booking,segments,status='IN_PROGRESS',opts={}) => {
    await db.query(`INSERT INTO "BookingItems" (id,"bookingId",segments,status,options,"serviceId",handover_skipped)
      VALUES($1,$2,$3,$4,$5,'svc',false)`, [id,booking,JSON.stringify(segments),status,JSON.stringify(opts)]);
  };
  const start = '2026-09-26T03:00:00Z', end = '2026-09-26T03:30:00Z';

  // Work ended, cleaning debt still open: release remains allowed. Old debt repayment cannot clear a new booking.
  await db.exec(`INSERT INTO "Bookings" (id,status) VALUES('old1','CLEANING'),('old2','CLEANING'),('new','IN_PROGRESS'),('unstarted','PREPARING');`);
  for (const id of ['old1','old2']) {
    await insert(id+'item',id,[{id:id+'seg',ktvId:'EXT_TEST',actualStartTime:start,actualEndTime:end}]);
    await db.query(`UPDATE "BookingItems" SET handover_status='SKIPPED',handover_skipped=true WHERE id=$1`,[id+'item']);
    await db.query(`INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status)
      VALUES('EXT_TEST','2026-09-26',$1,$2,$3,'ACTIVE')`,[id,id+'item',id+'seg']);
    await db.query(`SELECT ktv_release_work_atomic($1,'EXT_TEST','[]',NULL)`,[id]);
    assert.equal((await row('BookingItems',id+'item')).handover_status,'SKIPPED');
    assert.equal((await row('BookingItems',id+'item')).segments[0].handoverTime,undefined);
  }
  await db.exec(`INSERT INTO "TurnQueue" (employee_id,date,status,current_order_id) VALUES('EXT_TEST','2026-09-26','working','new');
    INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status) VALUES('EXT_TEST','2026-09-26','new','newitem','newseg','ACTIVE');`);
  const beforePromotions = (await db.query('SELECT count(*) FROM promotions')).rows[0].count;
  await db.query(`SELECT ktv_release_work_atomic('old1','EXT_TEST','["https://fixture/photo.webp"]',NULL)`);
  assert.equal((await row('BookingItems','old1item')).handover_status,'PENDING');
  assert.equal((await db.query('SELECT current_order_id FROM "TurnQueue" WHERE employee_id=$1',['EXT_TEST'])).rows[0].current_order_id,'new');
  assert.equal((await db.query('SELECT count(*) FROM promotions')).rows[0].count,beforePromotions);
  await insert('unstarteditem','unstarted',[{id:'unstartedseg',ktvId:'B'}],'PREPARING');
  await db.exec(`INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status)
    VALUES('B','2026-09-26','unstarted','unstarteditem','unstartedseg','ACTIVE')`);
  await assert.rejects(db.query(`SELECT ktv_release_work_atomic('unstarted','B','[]',NULL)`),/No completed live work/);
  assert.equal((await db.query(`SELECT status FROM "KtvAssignments" WHERE employee_id='B'`)).rows[0].status,'ACTIVE');
  console.log('PASS 2/5 two cleaning debts + external KTV release + repay old debt while serving new + reject unstarted release');

  // START rollback includes segments, booking, and TurnQueue. Existing snapshot transaction is reused.
  await db.exec(`INSERT INTO "Bookings" (id,status) VALUES('start','PREPARING');`);
  await insert('startitem','start',[{id:'startseg',ktvId:'A',startTime:'10:00',duration:30}],'PREPARING');
  const baseline = await row('BookingItems','startitem');
  const snapshotKeys = ['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'];
  const snapshot = Object.fromEntries(snapshotKeys.map(k=>[k,baseline[k]]));
  const startArgs = ['start',JSON.stringify({id:'start',status:'PREPARING',rating:null,timeStart:null}),JSON.stringify([snapshot]),'[]',
    JSON.stringify([{id:'startitem',status:'IN_PROGRESS',segments:[{...baseline.segments[0],actualStartTime:start}]}]),'A','startseg',start,
    JSON.stringify({status:'working',current_order_id:'start',start_time:'10:00',estimated_end_time:'10:30',booking_item_id:'startitem',booking_item_ids:['startitem']})];
  const startQuery = 'SELECT ktv_start_service_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result';
  await assert.rejects(db.query(startQuery,startArgs),/TurnQueue changed/);
  assert.deepEqual((await row('BookingItems','startitem')).segments,baseline.segments);
  assert.equal((await row('Bookings','start')).status,'PREPARING');
  await db.exec(`INSERT INTO "TurnQueue" (employee_id,date,status) VALUES('A','2026-09-26','assigned')`);
  const committed = (await db.query(startQuery,startArgs)).rows[0].result;
  assert.equal(committed.booking.status,'IN_PROGRESS');
  assert.equal(Date.parse(committed.booking.timeStart),Date.parse(start));
  const release = load('app/api/ktv/booking/_handlers/handleReleaseKTV.ts').handleReleaseKTV;
  const failure = await release({supabase:{rpc:async()=>({error:{message:'DB down'}})},bookingId:'old1',technicianCode:'EXT_TEST',body:{}});
  assert.equal(failure.earlyResponse.body.success,false);
  // Use the existing real-FINISH harness with candidate sources, then assert the new behavior.
  const harnessSource=fs.readFileSync(path.join(root,'scripts/test_sequential_finish_persistence.cjs'),'utf8');
  const harnessPrefix=harnessSource.slice(0,harnessSource.indexOf('async function main()'));
  const harness=new Function('require','__dirname',harnessPrefix+'\nreturn {database,item,run,segments};')(require,path.join(candidate,'scripts'));
  const first=harness.item('one'), later=harness.item('two'); later.status='PREPARING';delete later.segments[0].actualStartTime;
  const finishing=harness.database([first,later]);assert.equal((await harness.run(finishing)).bookingPersisted,true);
  assert.equal(harness.segments(finishing.rows[1])[0].actualStartTime,undefined);
  assert.equal(harness.segments(finishing.rows[1])[0].actualEndTime,undefined);
  assert.equal(finishing.rows[1].status,'PREPARING');
  const parent=harness.item('parent'), child=harness.item('child','B');child.options={mergedIntoId:'parent'};child.status='PREPARING';delete child.segments[0].actualStartTime;
  const children=harness.database([parent,child]);assert.equal((await harness.run(children,'A',['parent'])).bookingPersisted,true);
  assert.equal(children.rows[1].status,'PREPARING');
  const neverStarted=harness.item('never');delete neverStarted.segments[0].actualStartTime;
  assert.equal((await harness.run(harness.database([neverStarted]))).earlyResponse.body.success,false);
  const startHandler=load('app/api/ktv/booking/_handlers/handleStartTimer.ts').handleStartTimer;
  let startUploads=0, startCommits=[];
  const startRows=[{...harness.item('startone'),status:'PREPARING'},{...harness.item('starttwo'),status:'PREPARING'}];
  for(const item of startRows) delete item.segments[0].actualStartTime;
  startRows[0].segments[0].startTime='10:00';startRows[1].segments[0].startTime='11:00';startRows[1].segments[0].roomId='other';
  const startDb={from(table){const data=table==='Bookings'?{id:'booking',status:'PREPARING',rating:null,timeStart:null,bookingDate:'2026-09-26T10:00:00',BookingGuests:[]}:structuredClone(startRows);
    return {select(){return this},eq(){return this},single(){return this},then(resolve,reject){return Promise.resolve({data}).then(resolve,reject)}}},
    storage:{from(){return {upload:async()=>({data:{path:'proof-'+(++startUploads)}}),getPublicUrl:p=>({data:{publicUrl:'https://fixture/'+p}}),remove:async()=>({error:null})}}},
    rpc:async(name,args)=>{startCommits.push(args);return {data:{success:true,booking:{id:'booking',status:'IN_PROGRESS'}}}}};
  const proof='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
  const ctx={supabase:startDb,bookingId:'booking',technicianCode:'A',action:'START_TIMER',allItemIdsForThisKTV:['startone','starttwo'],body:{targetSegmentId:'startone-seg',activeSegmentIndex:0,shouldMerge:false,guestSlipperPhotoBase64:proof,startPhotoBase64:proof}};
  assert.equal((await startHandler(ctx)).bookingPersisted,true);
  assert.deepEqual(startCommits[0].p_updates.map(p=>p.id),['startone']);
  startRows[0].segments[0].actualStartTime=start;
  assert.equal((await startHandler(ctx)).bookingPersisted,true);
  assert.equal(startCommits.length,1);assert.equal(startUploads,2);
  console.log('PASS 3/5 atomic START rollback/commit + RELEASE error + actual FINISH does not fabricate or complete independent child');

  // The authoritative service day rejects arbitrary B dates, including early dispatch requests.
  await db.exec(`INSERT INTO "Bookings" (id,status) VALUES('sequence','IN_PROGRESS');
    INSERT INTO "Staff" VALUES('SEQ_B','ĐANG LÀM');
    INSERT INTO "TurnQueue" (employee_id,date,status) VALUES('SEQ_B','2026-09-26','waiting');`);
  await insert('seqitem','sequence',[{id:'seqA',ktvId:'SEQ_A',sequenceSlot:1,roomId:'R',bedId:'X',startTime:'10:00',endTime:'10:30',duration:30,actualStartTime:start,actualEndTime:end}], 'IN_PROGRESS',{sequentialSlots:2});
  await db.query(`INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status,planned_start_time,planned_end_time)
    VALUES('SEQ_A','2026-09-26','sequence','seqitem','seqA','COMPLETED',$1,$2)`,[start,end]);
  await assert.rejects(db.query(`SELECT dispatch_assign_sequential_slot_b('sequence','seqitem','SEQ_B','2026-09-27 10:30+07',30,false)`),/service day/);
  await db.query(`SELECT dispatch_assign_sequential_slot_b('sequence','seqitem','SEQ_B','2026-09-26 10:30+07',30,false)`);
  await db.query(`SELECT dispatch_finish_sequential_after_a('sequence','seqitem')`);
  assert.equal((await row('Bookings','sequence')).status,'CLEANING');
  const doubleEncoded = JSON.stringify(JSON.stringify({sequentialSlots:2}));
  const normalized = (await db.query('SELECT jsonb_unwrap_string($1::jsonb) AS result',[doubleEncoded])).rows[0].result;
  assert.equal(normalized.sequentialSlots,2);
  console.log('PASS 4/5 server service day + FINISH_AFTER_A booking sync + double-encoded SQL options');

  // Rejected dispatch rolls back guest creation, guestCount, guest_id, and queue-tail creation.
  await db.exec(`INSERT INTO "Bookings" (id,status,"guestCount") VALUES('dispatch','PREPARING',1);`);
  await insert('dispatchitem','dispatch',[{id:'dseg',ktvId:'D'}],'PREPARING',{dispatchRevision:0});
  const payload = {date:'2026-09-26',guestCount:2,newGuests:[{id:'newguest',booking_id:'dispatch',guest_index:1,guest_label:'Khách 1'}],
    turnStaffIds:['D'],itemUpdates:[{id:'dispatchitem',options:{dispatchRevision:0},guest_id:'newguest'}],staffAssignments:[]};
  await assert.rejects(db.query(`SELECT dispatch_apply_edit('dispatch','DISPATCH',$1,'{}')`,[JSON.stringify(payload)]),/fixture dispatch refused/);
  assert.equal((await row('Bookings','dispatch')).guestCount,1);
  assert.equal((await row('BookingItems','dispatchitem')).guest_id,null);
  assert.equal((await db.query('SELECT count(*) FROM "BookingGuests" WHERE id=$1',['newguest'])).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*) FROM "TurnQueue" WHERE employee_id=$1',['D'])).rows[0].count,0);
  await assert.rejects(db.query(`SELECT dispatch_apply_edit('dispatch','DISPATCH',$1,'{}')`,[JSON.stringify({...payload,itemUpdates:[{...payload.itemUpdates[0],options:{dispatchRevision:1}}]})]),/bản lưu mới/);
  console.log('PASS 5/5 rejected DISPATCH rolls back all guest/count/queue writes');
  await db.close();
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
