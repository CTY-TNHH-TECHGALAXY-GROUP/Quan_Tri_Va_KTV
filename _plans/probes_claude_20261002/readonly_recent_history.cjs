// Read-only: recent dispatch revision history of items edited at the counter.
const fs=require('fs');const {Client}=require('pg');const env=require('dotenv').parse(fs.readFileSync('.env.local'));
const HOURS=Number(process.argv[2]||10);
(async()=>{const db=new Client({connectionString:env.DATABASE_URL});await db.connect();
 const rows=(await db.query(`select i.id, i.status, jsonb_unwrap_string(i.options) o from "BookingItems" i join "Bookings" b on b.id=i."bookingId" where b."updatedAt" > now() - make_interval(hours => $1) order by i.id`,[HOURS])).rows;
 for(const r of rows){const h=(r.o.dispatchHistory||[]).filter(x=>new Date(x.at)>Date.now()-HOURS*3600e3);
  if(!h.some(x=>/UNASSIGN|DRAFT|DISPATCH|ASSIGN_B|EDIT|FINISH/.test(x.action)))continue;
  console.log('\n#',r.id,r.status,'seq='+(r.o.sequentialSlots||'-'),'closed='+JSON.stringify(r.o.closedSequentialSlots||[]));
  for(const x of h)console.log(' r'+x.revision,String(x.at).slice(11,19),x.action,(x.changes||[]).map(c=>`${c.employeeId||''}.${c.field}:${JSON.stringify(c.before)}→${JSON.stringify(c.after)}`.slice(0,70)).join(' ; ').slice(0,260));}
 await db.end()})().catch(e=>{console.error(e.message);process.exit(1)});
