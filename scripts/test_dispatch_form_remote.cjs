// Isolated test project only. Every QA row is temporary and rolled back.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {Client}=require('pg');const {createClient}=require('@supabase/supabase-js');
const env=require('dotenv').parse(fs.readFileSync(path.join(__dirname,'../.env.local')));const ref='eknggruuiuadwldacpmb';
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,ref+'.supabase.co');const url=new URL(env.DATABASE_URL);
assert.ok(url.hostname==='db.'+ref+'.supabase.co' || decodeURIComponent(url.username).endsWith('.'+ref));
const db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000});const prefix='SEQ_FORM_QA_'+process.pid;
const bid=prefix,iid=prefix+'_ITEM',a=prefix+'A',b=prefix+'B',c=prefix+'C';let day;
const item=async()=>(await db.query('SELECT to_jsonb(i) AS item FROM "BookingItems" i WHERE id=$1',[iid])).rows[0].item;
const at=clock=>day+'T'+clock+':00+07:00';const actor=JSON.stringify({id:'SEQ_TEST_ADMIN',name:'Form QA'});
const apply=async(action,payload)=>(await db.query(`SELECT ${['DRAFT','DISPATCH'].includes(action) ? 'dispatch_commit_form' : 'dispatch_apply_edit'}($1,$2,$3,$4) AS result`,[bid,action,JSON.stringify(payload),actor])).rows[0].result;
const make=(id,ktvId,start,end,duration,slot)=>({id,ktvId,startTime:start,endTime:end,duration,sequenceSlot:slot,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1'});
async function reject(operation,pattern){await db.query('SAVEPOINT rejected');try{await assert.rejects(operation,pattern);}finally{await db.query('ROLLBACK TO SAVEPOINT rejected');await db.query('RELEASE SAVEPOINT rejected');}}
(async()=>{await db.connect();try{await db.query('BEGIN');try{
 day=(await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day")).rows[0].day;
 for(const staff of [a,b,c]){await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status) VALUES($1,$1,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`,[staff]);
 await db.query(`INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status) VALUES($1,$2,999,999,'waiting')`,[staff,day]);}
 await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount") VALUES($1,$1,$2,now(),'STANDARD_WALK_IN',300000)`,[bid,day]);
 await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options) VALUES($1,$2,'SEQ_TEST_SVC_60',300000,'NEW','{}')`,[iid,bid]);
 let saved=await item();let segments=[make('a',a,'10:00','10:30',30,1)];
 await apply('DRAFT',{itemUpdates:[{id:iid,segments,technicianCodes:[a],options:{...saved.options,sequentialSlots:2}}]});
 saved=await item();assert.equal(saved.status,'NEW');assert.equal((await db.query('SELECT count(*)::int AS n FROM "KtvAssignments" WHERE booking_id=$1',[bid])).rows[0].n,0);
 segments.push(make('b',b,'10:30','11:00',30,2));
 await apply('DRAFT',{itemUpdates:[{id:iid,segments,technicianCodes:[a,b],options:{...saved.options,sequentialSlots:2}}]});
 saved=await item();assert.equal(saved.segments.length,2);assert.equal(saved.status,'NEW');
 console.log('PASS real DB: Save A draft then Save A/B draft without dispatching either employee');
 await apply('DISPATCH',{date:day,status:'PREPARING',technicianCode:a+' - '+b,roomName:'TEST Phòng nối tiếp',bedId:'SEQ_TEST_BED_1',
 itemUpdates:[{id:iid,status:'PREPARING',segments:saved.segments,options:saved.options,technicianCodes:[a,b],roomName:'TEST Phòng nối tiếp',bedId:'SEQ_TEST_BED_1'}],
 staffAssignments:saved.segments.map(s=>({ktvId:s.ktvId,bookingItemId:iid,segmentId:s.id,startTime:s.startTime,endTime:s.endTime,roomId:s.roomId,bedId:s.bedId,queuePos:999}))});
 saved=await item();segments=structuredClone(saved.segments);segments[0].duration=35;segments[0].endTime='10:35';segments[1].startTime='10:35';segments[1].endTime='11:10';segments[1].duration=35;
 await apply('DRAFT',{itemUpdates:[{id:iid,segments,options:saved.options}]});saved=await item();
 assert.deepEqual((await db.query('SELECT EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS minutes FROM "KtvAssignments" WHERE booking_item_id=$1 ORDER BY employee_id',[iid])).rows.map(r=>Number(r.minutes)),[35,35]);
 console.log('PASS real DB: unstarted A/B duration edits update both assignment plans');
 const booking=(await db.query('SELECT to_jsonb(b) AS b FROM "Bookings" b WHERE id=$1',[bid])).rows[0].b;
 const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));segments=structuredClone(saved.segments);segments[0].actualStartTime=at('10:00');
 await db.query(`SELECT ktv_start_service_atomic($1,$2,$3,'[]',$4,$5,$6,$7,$8)`,[bid,JSON.stringify(pick(booking,['id','status','rating','timeStart'])),
 JSON.stringify([pick(saved,['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'])]),
 JSON.stringify([{id:iid,status:'IN_PROGRESS',segments}]),a,'a',at('10:00'),JSON.stringify({status:'working',current_order_id:bid,booking_item_id:iid,booking_item_ids:[iid],start_time:'10:00',estimated_end_time:'10:35'})]);
 saved=await item();const preservedA=structuredClone(saved.segments[0]);
 await apply('ASSIGN_B',{itemId:iid,toKtvId:c,expectedRevision:saved.options.dispatchRevision,plannedStartAt:at('10:35'),durationMinutes:45,confirmOverlap:false,
 metadata:{serviceNamesForKtvs:{[a]:'Tên A',[c]:'C mới'},notesForKtvs:{[c]:'Ghi chú C'}}});saved=await item();
 assert.deepEqual(saved.segments[0],preservedA);assert.ok(saved.segments.some(s=>s.ktvId===b && s.voided===true));assert.equal(saved.segments.find(s=>s.ktvId===c).duration,45);
 segments=structuredClone(saved.segments);const nextC=segments.find(s=>s.ktvId===c && !s.voided);nextC.duration=50;nextC.endTime='11:25';
 await apply('DRAFT',{itemUpdates:[{id:iid,segments,options:{...saved.options,serviceNamesForKtvs:{...saved.options.serviceNamesForKtvs,[c]:'C sửa lần 2'}}}]});saved=await item();
 assert.equal(saved.options.serviceNamesForKtvs[c],'C sửa lần 2');assert.equal(saved.segments.find(s=>s.ktvId===c).duration,50);assert.deepEqual(saved.segments[0],preservedA);
 console.log('PASS real DB: A running, replace B→C, change C name/duration twice, preserve A');
 const before=structuredClone(saved);
 await reject(()=>db.query('SELECT dispatch_unassign_unstarted_staffs($1,$2,$3,$4,$5)',[bid,iid,[c,a],saved.options.dispatchRevision,actor]),/bắt đầu/);
 assert.deepEqual(await item(),before,'bulk failure must not leave C unassigned');
 const removed=(await db.query('SELECT dispatch_unassign_unstarted_staffs($1,$2,$3,$4,$5) AS r',[bid,iid,[c],saved.options.dispatchRevision,actor])).rows[0].r;
 assert.equal(removed.success,true);saved=await item();assert.equal(saved.options.closedSequentialSlots,undefined);assert.deepEqual(saved.segments[0],preservedA);
 await apply('ASSIGN_B',{itemId:iid,toKtvId:b,expectedRevision:saved.options.dispatchRevision,plannedStartAt:at('10:35'),durationMinutes:40,confirmOverlap:false});saved=await item();
 assert.equal(saved.segments.find(s=>s.ktvId===b && !s.voided).duration,40);
 await reject(()=>db.query('SELECT dispatch_unassign_unstarted_staffs($1,$2,$3,0,$4)',[bid,iid,[b],actor]),/bản lưu mới/);
 assert.deepEqual(await item(),saved);
 console.log('PASS real DB: remove C, reassign B, stale/bulk guards and preserved history');
 const removedB=(await db.query('SELECT dispatch_unassign_unstarted_staffs($1,$2,$3,$4,$5) AS r',[bid,iid,[b],saved.options.dispatchRevision,actor])).rows[0].r;
 assert.equal(removedB.success,true);saved=await item();
 const actualStart=saved.segments.find(s=>s.id==='a').actualStartTime;
 segments=structuredClone(saved.segments);segments.find(s=>s.id==='a').duration=45;segments.find(s=>s.id==='a').endTime='10:45';
 let changed=await apply('DRAFT',{itemUpdates:[{id:iid,segments,options:saved.options}]});
 assert.equal(changed.durationChanges[0].minutes,45);saved=await item();
 assert.ok(!saved.options.closedSequentialSlots?.includes(2),'B stays open below the item service duration');
 assert.equal(saved.segments.find(s=>s.id==='a').duration,45);
 segments=structuredClone(saved.segments);segments.find(s=>s.id==='a').duration=60;segments.find(s=>s.id==='a').endTime='11:00';
 const staleRevision=saved.options.dispatchRevision;
 changed=await apply('DISPATCH',{date:day,status:'IN_PROGRESS',itemUpdates:[{id:iid,segments,options:saved.options}]});
 assert.equal(changed.durationChanges[0].minutes,60);saved=await item();
 assert.equal(saved.segments.find(s=>s.id==='a').actualStartTime,actualStart);
 assert.equal(saved.segments.find(s=>s.id==='a').duration,60);
 assert.deepEqual(saved.options.closedSequentialSlots,[2]);
 assert.equal(saved.status,'IN_PROGRESS');
 assert.equal(Number((await db.query('SELECT EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS minutes FROM "KtvAssignments" WHERE booking_item_id=$1 AND employee_id=$2',[iid,a])).rows[0].minutes),60);
 assert.equal((await db.query('SELECT estimated_end_time::text AS clock FROM "TurnQueue" WHERE employee_id=$1 AND date=$2',[a,day])).rows[0].clock,'11:00:00');
 segments=structuredClone(saved.segments);segments.find(s=>s.id==='a').duration=70;segments.find(s=>s.id==='a').endTime='11:10';
 await reject(()=>apply('DRAFT',{itemUpdates:[{id:iid,segments,options:{...saved.options,dispatchRevision:staleRevision}}]}),/Ca đã thay đổi/);
 console.log('PASS real DB: running A edited via Save/Dispatch, dynamic B closure, assignment clock and stale guard');
 const ninetyId=iid+'_90',ninetyStaff=prefix+'D';
 await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status) VALUES($1,$1,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`,[ninetyStaff]);
 await db.query(`INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status,current_order_id,booking_item_id,booking_item_ids,start_time,estimated_end_time)
  VALUES($1,$2,998,998,'working',$3,$4,ARRAY[$4]::text[],'12:00','12:30')`,[ninetyStaff,day,bid,ninetyId]);
 const ninetyA={...make('a90',ninetyStaff,'12:00','12:30',30,1),actualStartTime:at('12:00')};
 await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,segments,options,"technicianCodes")
  VALUES($1,$2,'SEQ_TEST_SVC_90',300000,'IN_PROGRESS',$3,'{"sequentialSlots":2,"dispatchRevision":0}',ARRAY[$4]::text[])`,[ninetyId,bid,JSON.stringify([ninetyA]),ninetyStaff]);
 await db.query(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,segment_id,status,planned_start_time,planned_end_time)
  VALUES($1,$2,$3,$4,'a90','ACTIVE',$5,$6)`,[ninetyStaff,day,bid,ninetyId,at('12:00'),at('12:30')]);
 let ninety=(await db.query('SELECT to_jsonb(i) AS item FROM "BookingItems" i WHERE id=$1',[ninetyId])).rows[0].item;
 let ninetySegs=[{...ninetyA,duration:60,endTime:'13:00'}];
 let ninetyResult=await apply('DRAFT',{itemUpdates:[{id:ninetyId,segments:ninetySegs,options:ninety.options}]});
 assert.equal(ninetyResult.durationChanges[0].closedB,false);
 ninety=(await db.query('SELECT to_jsonb(i) AS item FROM "BookingItems" i WHERE id=$1',[ninetyId])).rows[0].item;
 ninetySegs=structuredClone(ninety.segments);ninetySegs[0].duration=90;ninetySegs[0].endTime='13:30';
 await reject(()=>apply('DRAFT',{itemUpdates:[{id:ninetyId,segments:ninetySegs,options:ninety.options},
  {id:iid,segments:saved.segments,options:{...saved.options,dispatchRevision:0}}]}),/bản lưu mới/);
 assert.deepEqual((await db.query('SELECT to_jsonb(i) AS item FROM "BookingItems" i WHERE id=$1',[ninetyId])).rows[0].item,ninety,
  'a stale sibling item must roll back the running-A duration update');
 ninetyResult=await apply('DRAFT',{itemUpdates:[{id:ninetyId,segments:ninetySegs,options:ninety.options}]});
 assert.equal(ninetyResult.durationChanges[0].closedB,true);
 console.log('PASS real DB: 90-minute service keeps B open at A=60 and closes B at A=90, with no B ever assigned');
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 }finally{await db.query('ROLLBACK');}
 assert.equal((await db.query('SELECT count(*)::int AS n FROM "Bookings" WHERE id=$1',[bid])).rows[0].n,0);
 console.log('PASS remote form QA; all temporary staff/bookings/assignments rolled back');
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
 const formRpc=await client.rpc('dispatch_commit_form',{p_booking_id:'__MISSING_QA__',p_action:'DRAFT',p_payload:{itemUpdates:[]},p_actor:{id:'SEQ_TEST_ADMIN'}});
 assert.match(formRpc.error?.message || '',/Không tìm thấy đơn/,'PostgREST schema must expose the Save/Dispatch RPC');
 console.log('PASS PostgREST schema cache resolves Save/Dispatch RPC');
 }finally{await db.end();}})().catch(error=>{console.error('FAILED:',error.message);process.exitCode=1;});
