// Isolated Supabase TEST only; all synthetic rows roll back.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {Client}=require('pg');
const env=require('dotenv').parse(fs.readFileSync(path.join(__dirname,'../.env.local')));
const ref='eknggruuiuadwldacpmb';const url=new URL(env.DATABASE_URL);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,ref+'.supabase.co');
assert.ok(url.hostname==='db.'+ref+'.supabase.co'||decodeURIComponent(url.username).endsWith('.'+ref));
const db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000});
const prefix='SEQ_START_QA_'+process.pid,oldBooking=prefix+'_OLD',newBooking=prefix+'_NEW';
const oldItem=oldBooking+'_ITEM',newItem=newBooking+'_ITEM',employee=prefix+'_KTV';
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
(async()=>{await db.connect();try{await db.query('BEGIN');try{
 const day=(await db.query("SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day")).rows[0].day;
 const local=clock=>`${day.toISOString().slice(0,10)}T${clock}:00+07:00`;
 const oldSeg={id:'old-seg',ktvId:employee,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1',startTime:'10:00',endTime:'10:30',duration:30,
  actualStartTime:local('10:00'),actualEndTime:local('10:30')};
 const newSeg={id:'new-seg',ktvId:employee,sequenceSlot:1,roomId:'SEQ_TEST_ROOM',bedId:'SEQ_TEST_BED_1',startTime:'11:00',endTime:'11:30',duration:30};
 await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status) VALUES($1,$1,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`,[employee]);
 for(const id of [oldBooking,newBooking]) await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","updatedAt",source,"totalAmount",status)
  VALUES($1,$1,$2,now(),'STANDARD_WALK_IN',300000,$3)`,[id,day,id===oldBooking?'FEEDBACK':'NEW']);
 await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,segments,options,"technicianCodes")
  VALUES($1,$2,'SEQ_TEST_SVC_60',300000,'FEEDBACK',$3,'{}',ARRAY[$4]::text[])`,[oldItem,oldBooking,JSON.stringify([oldSeg]),employee]);
 await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,segments,options,"technicianCodes")
  VALUES($1,$2,'SEQ_TEST_SVC_60',300000,'PREPARING',$3,'{"sequentialSlots":2}',ARRAY[$4]::text[])`,[newItem,newBooking,JSON.stringify([newSeg]),employee]);
 await db.query(`INSERT INTO "KtvAssignments"(employee_id,business_date,booking_id,booking_item_id,segment_id,status,planned_start_time,planned_end_time)
  VALUES($1,$2,$3,$4,'old-seg','COMPLETED',$5,$6),($1,$2,$7,$8,'new-seg','ACTIVE',$9,$10)`,
  [employee,day,oldBooking,oldItem,local('10:00'),local('10:30'),newBooking,newItem,local('11:00'),local('11:30')]);
 await db.query(`INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status,current_order_id,booking_item_id,booking_item_ids,start_time,estimated_end_time)
  VALUES($1,$2,998,998,'working',$3,$4,ARRAY[$4]::text[],'10:00','10:30')`,[employee,day,oldBooking,oldItem]);
 const start=async()=>{const booking=(await db.query('SELECT to_jsonb(b) AS value FROM "Bookings" b WHERE id=$1',[newBooking])).rows[0].value;
  const item=(await db.query('SELECT to_jsonb(i) AS value FROM "BookingItems" i WHERE id=$1',[newItem])).rows[0].value;
  const now=new Date().toISOString();const updated=[{id:newItem,status:'IN_PROGRESS',segments:[{...newSeg,actualStartTime:now}]}];
  return (await db.query(`SELECT ktv_start_service_atomic($1,$2,$3,'[]',$4,$5,$6,$7,$8) AS result`,[
    newBooking,JSON.stringify(pick(booking,['id','status','rating','timeStart'])),
    JSON.stringify([pick(item,['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'])]),
    JSON.stringify(updated),employee,'new-seg',now,JSON.stringify({status:'working',current_order_id:newBooking,booking_item_id:newItem,booking_item_ids:[newItem],start_time:'11:00',estimated_end_time:'11:30'})])).rows[0].result;};
 await db.query('SAVEPOINT unhanded');
 try{await assert.rejects(start(),/Ca trước chưa bàn giao/);}finally{await db.query('ROLLBACK TO SAVEPOINT unhanded');await db.query('RELEASE SAVEPOINT unhanded');}
 await db.query(`UPDATE "BookingItems" SET segments=$2 WHERE id=$1`,[oldItem,JSON.stringify([{...oldSeg,handoverTime:local('10:35')}])]);
 const result=await start();assert.equal(result.success,true);
 assert.equal((await db.query('SELECT current_order_id FROM "TurnQueue" WHERE employee_id=$1 AND date=$2',[employee,day])).rows[0].current_order_id,newBooking);
 assert.equal((await db.query('SELECT status FROM "BookingItems" WHERE id=$1',[newItem])).rows[0].status,'IN_PROGRESS');
 console.log('PASS stale TurnQueue: unhanded old work blocks START; handed-over work lets ACTIVE next assignment start');
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 }finally{await db.query('ROLLBACK');}console.log('PASS synthetic booking, KTV and queue rows rolled back');
 }finally{await db.end();}})().catch(error=>{console.error('FAILED:',error.message);process.exitCode=1;});
