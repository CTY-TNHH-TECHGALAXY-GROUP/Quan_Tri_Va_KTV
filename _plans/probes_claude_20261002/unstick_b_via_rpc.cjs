// TEST-only: finish what old reject left behind for SEQ_TEST_B, via the same RPC the new reject route uses.
const fs=require('fs');const {Client}=require('pg');const env=require('dotenv').parse(fs.readFileSync('.env.local'));
if(!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
const MODE=process.env.MODE||'dry'; const W='SEQ_TEST_B';
const TARGETS=[['QA_WEB_20261001_B9','QA_WEB_20261001_B9_I2'],['SEQ_TEST_ORDER_2','SEQ_TEST_ORDER_2_ITEM'],['SEQ_PENDING_20260928_3','SEQ_PENDING_20260928_3_ITEM_1']];
(async()=>{const db=new Client({connectionString:env.DATABASE_URL});await db.connect();await db.query('begin');
 try{
  for(const [bk,it] of TARGETS){
   const rev=(await db.query(`select coalesce((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0) r from "BookingItems" where id=$1`,[it])).rows[0].r;
   const r=(await db.query(`select dispatch_unassign_unstarted_staff($1,$2,$3,$4,$5::jsonb,true) r`,[bk,it,W,rev,JSON.stringify({id:'claude-qa',name:'QA gỡ kẹt seq_b',verified:false})])).rows[0].r;
   const row=(await db.query(`select status,"technicianCodes" c,segments from "BookingItems" where id=$1`,[it])).rows[0];
   const segs=(typeof row.segments==='string'?JSON.parse(row.segments):row.segments).map(s=>`${s.ktvId}:void=${s.voided}`);
   console.log(it,JSON.stringify(r),row.status,JSON.stringify(row.c),segs.join(' '));
  }
  console.log('KA open',(await db.query(`select booking_id,status from "KtvAssignments" where employee_id=$1 and status in ('ACTIVE','QUEUED','READY')`,[W])).rows);
  console.log('TQ',(await db.query(`select status,current_order_id,booking_item_ids from "TurnQueue" where employee_id=$1 order by date desc limit 1`,[W])).rows[0]);
  await db.query(MODE==='apply'?'commit':'rollback');console.log(MODE,MODE==='apply'?'COMMITTED':'ROLLED BACK');
 }catch(e){await db.query('rollback');console.error('ERR',e.message);process.exitCode=1}finally{await db.end()}})();
