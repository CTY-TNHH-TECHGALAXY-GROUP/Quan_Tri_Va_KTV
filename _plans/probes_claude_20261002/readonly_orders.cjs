// Read-only: dump orders (by id prefix) with items, segments, assignments and recent notifications.
const fs=require('fs');const {Client}=require('pg');const env=require('dotenv').parse(fs.readFileSync('.env.local'));
const j=v=>typeof v==='string'?JSON.parse(v||'null'):v; const t=v=>v?String(v instanceof Date?v.toISOString():v).slice(11,19):'-';
(async()=>{const db=new Client({connectionString:env.DATABASE_URL});await db.connect();
 for(const b of (await db.query(`select id,status,"updatedAt" from "Bookings" where id like $1 order by id`,[process.argv[2]+'%'])).rows){
  console.log('\n##',b.id,b.status,'upd',t(b.updatedAt));
  for(const i of (await db.query(`select * from "BookingItems" where "bookingId"=$1 order by id`,[b.id])).rows){const o=j(i.options)||{};
   console.log(' item',i.id,i.status,JSON.stringify(i.technicianCodes),'seq='+(o.sequentialSlots||'-'),'closed='+JSON.stringify(o.closedSequentialSlots||[]),'rev='+o.dispatchRevision,'acc='+Object.keys(o.acceptedByStaff||{}).join('/'));
   for(const s of j(i.segments)||[])console.log('   seg',s.ktvId,'slot='+(s.sequenceSlot||'-'),s.startTime+'-'+s.endTime,'dur='+s.duration,'S='+t(s.actualStartTime),'E='+t(s.actualEndTime),'void='+s.voided,s.note||'');}
  for(const k of (await db.query(`select employee_id,status,planned_start_time p,updated_at from "KtvAssignments" where booking_id=$1 order by created_at`,[b.id])).rows)console.log(' KA',k.employee_id,k.status,t(k.p),'upd',t(k.updated_at));
  for(const n of (await db.query(`select "createdAt",type,"employeeId",message from "StaffNotifications" where "bookingId"=$1 order by "createdAt"`,[b.id])).rows)console.log(' N',t(n.createdAt),n.type,n.employeeId||'',n.message.slice(0,90));
 }
 await db.end()})().catch(e=>{console.error(e.message);process.exit(1)});
