// TEST-only: release stale ACTIVE assignments of SEQ_TEST_B / SEQ_TEST_C from 27-28/09.
const fs=require('fs'); const {Client}=require('pg');
const env=require('dotenv').parse(fs.readFileSync('.env.local'));
const MODE=process.env.MODE||'dry';
const B_ORDERS=['SEQ_TEST_ORDER_2','SEQ_PENDING_20260928_3']; const C_ORDER='SEQ_TEST_ORDER_5';
const j=v=>typeof v==='string'?JSON.parse(v||'null'):v;
(async()=>{
  if(!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST db');
  const db=new Client({connectionString:env.DATABASE_URL}); await db.connect(); await db.query('begin');
  try{
    const ka=await db.query(`update "KtvAssignments" set status='CANCELLED' where booking_id = any($1) and status in ('ACTIVE','QUEUED','READY') returning booking_id,employee_id`,[[...B_ORDERS,C_ORDER]]);
    console.log('KA cancelled:',ka.rows);
    for(const id of B_ORDERS){
      for(const it of (await db.query(`select id,segments,options,"technicianCodes" from "BookingItems" where "bookingId"=$1`,[id])).rows){
        const segs=(j(it.segments)||[]).map(s=>s.ktvId==='SEQ_TEST_B'&&!s.actualStartTime?{...s,voided:true,note:'UNASSIGNED'}:s);
        const o=j(it.options)||{}; const acc={...(o.acceptedByStaff||{})}; delete acc.SEQ_TEST_B;
        const codes=(it.technicianCodes||[]).filter(c=>c!=='SEQ_TEST_B');
        await db.query(`update "BookingItems" set segments=$2,options=$3,"technicianCodes"=$4,status='PREPARING' where id=$1`,[it.id,JSON.stringify(segs),JSON.stringify({...o,acceptedByStaff:acc}),codes]);
        console.log('item released',it.id,'codes',codes);
      }
    }
    const c1=await db.query(`update "BookingItems" set status='CANCELLED' where "bookingId"=$1 returning id`,[C_ORDER]);
    const c2=await db.query(`update "Bookings" set status='CANCELLED' where id=$1 returning id,status`,[C_ORDER]);
    console.log('C order cancelled:',c1.rows,c2.rows);
    const left=await db.query(`select employee_id,booking_id,status,business_date from "KtvAssignments" where employee_id in ('SEQ_TEST_B','SEQ_TEST_C') and status in ('ACTIVE','QUEUED','READY')`);
    console.log('open assignments left:',left.rows.map(r=>[r.employee_id,r.booking_id,r.status].join(' ')));
    await db.query(MODE==='apply'?'commit':'rollback'); console.log('MODE',MODE, MODE==='apply'?'COMMITTED':'ROLLED BACK');
  }catch(e){await db.query('rollback'); throw e;} finally{await db.end();}
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
