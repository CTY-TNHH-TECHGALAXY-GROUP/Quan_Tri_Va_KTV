// TEST-only: 5 unassigned orders starting ~10 min from now, inside the current business day.
const assert=require('node:assert/strict'); const fs=require('fs'); const {Client}=require('pg');
const env=require('dotenv').parse(fs.readFileSync('.env.local'));
assert.ok(String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb'),'Not TEST db');
const cases=[
  ['Một KTV 60 phút',['SEQ_TEST_SVC_60']],
  ['Nối tiếp A/B 90 phút, sửa A khi đã gán B',['SEQ_TEST_SVC_90']],
  ['A đang làm: sửa thời lượng, bỏ B',['SEQ_TEST_SVC_90']],
  ['KTV từ chối đơn / nhận đơn tiếp',['SEQ_TEST_SVC_60']],
  ['Hai dịch vụ 60/90 phút trên cùng đơn',['SEQ_TEST_SVC_60','SEQ_TEST_SVC_90']],
];
(async()=>{
  const db=new Client({connectionString:env.DATABASE_URL}); await db.connect();
  const STEP=10*60e3; const base=Math.ceil((Date.now()+10*60e3)/STEP)*STEP;
  const vn=ms=>new Date(ms+7*3600e3).toISOString();
  const tag=vn(Date.now()).slice(0,16).replace(/\D/g,'').slice(4); // MMDDHHmm
  await db.query('begin');
  try{
    for(const [i,[label,svcs]] of cases.entries()){
      const id=`SEQ_LIVE_${tag}_${i+1}`; const at=base+i*STEP;
      await db.query(`insert into "Bookings"(id,"billCode","bookingDate","timeBooking","customerName","updatedAt",source,"totalAmount",status)
        values($1,$1,$2::timestamp,$3,$4,now(),'STANDARD_WALK_IN',$5,'NEW')`,
        [id,new Date(at).toISOString().slice(0,19),vn(at).slice(11,16),`TEST LIVE ${i+1} - ${label}`,svcs.length*300000]);
      for(const [k,s] of svcs.entries()) await db.query(`insert into "BookingItems"(id,"bookingId","serviceId",price,status,options) values($1,$2,$3,300000,'NEW','{}'::jsonb)`,[`${id}_ITEM_${k+1}`,id,s]);
      console.log(`${id} | ${vn(at).slice(11,16)} | ${label} | ${svcs.length} DV | NEW, chưa gán`);
    }
    await db.query('commit');
  }catch(e){await db.query('rollback');throw e}finally{await db.end()}
})().catch(e=>{console.error('FAILED',e.message);process.exit(1)});
