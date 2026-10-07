// Read-only: one KTV's queue, open/recent assignments and the orders behind them. Usage: node … <KTV_ID>
const fs=require('fs');const {Client}=require('pg');const env=require('dotenv').parse(fs.readFileSync('.env.local'));
const j=v=>typeof v==='string'?JSON.parse(v||'null'):v; const t=v=>v?String(v instanceof Date?v.toISOString():v).slice(11,19):'-';
(async()=>{const db=new Client({connectionString:env.DATABASE_URL});await db.connect(); const W=process.argv[2];
 console.log('TQ',(await db.query(`select to_char(date,'MM-DD') d,status,current_order_id,booking_item_ids from "TurnQueue" where employee_id=$1 order by date desc limit 1`,[W])).rows[0]);
 const kas=(await db.query(`select booking_id,booking_item_id,status,to_char(business_date,'MM-DD') d,updated_at from "KtvAssignments" where employee_id=$1 and (status in ('ACTIVE','QUEUED','READY') or updated_at>now()-interval '4 hours') order by updated_at desc`,[W])).rows;
 for(const k of kas) console.log('KA',k.booking_id,k.booking_item_id,k.status,k.d,t(k.updated_at));
 for(const id of [...new Set(kas.map(k=>k.booking_id))]){const b=(await db.query(`select id,status,rating from "Bookings" where id=$1`,[id])).rows[0];console.log('\n##',JSON.stringify(b));
  for(const i of (await db.query(`select * from "BookingItems" where "bookingId"=$1 order by id`,[id])).rows){const o=j(i.options)||{};
   console.log(' item',i.id,i.status,JSON.stringify(i.technicianCodes),'hs='+i.handover_status,'skip='+i.handover_skipped,'sub='+t(i.handover_submitted_at),'seq='+(o.sequentialSlots||'-'),'closed='+JSON.stringify(o.closedSequentialSlots||[]),'fin='+(o.finishedAfterA||'-'),'rev='+o.dispatchRevision,'rating='+i.itemRating);
   for(const s of j(i.segments)||[])console.log('   seg',s.ktvId,'slot='+(s.sequenceSlot||'-'),'S='+t(s.actualStartTime),'E='+t(s.actualEndTime),'HO='+t(s.handoverTime),'FB='+t(s.feedbackTime),'void='+!!s.voided,s.note||'');}}
 await db.end()})().catch(e=>{console.error(e.message);process.exit(1)});
