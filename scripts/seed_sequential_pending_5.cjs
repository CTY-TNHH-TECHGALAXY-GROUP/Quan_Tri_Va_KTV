// Five persistent, unassigned orders in the isolated TEST project only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env.local')));
const ref = 'eknggruuiuadwldacpmb';
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
const dbUrl = new URL(env.DATABASE_URL);
assert.ok(dbUrl.hostname === 'db.' + ref + '.supabase.co' || decodeURIComponent(dbUrl.username).endsWith('.' + ref));
const cases = [
  ['Một KTV, dịch vụ 60 phút', ['SEQ_TEST_SVC_60']],
  ['Nối tiếp A/B, dịch vụ 60 phút', ['SEQ_TEST_SVC_60']],
  ['Nối tiếp A/B, dịch vụ 90 phút', ['SEQ_TEST_SVC_90']],
  ['A đang làm, sửa thời lượng rồi gán B', ['SEQ_TEST_SVC_90']],
  ['Hai dịch vụ 60 và 90 phút', ['SEQ_TEST_SVC_60', 'SEQ_TEST_SVC_90']],
];

async function main() {
  const db = new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000});
  await db.connect();
  try {
    const day = (await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day")).rows[0].day;
    const prefix = 'SEQ_PENDING_' + day.replaceAll('-', '') + '_';
    await db.query('BEGIN');
    try {
      const existing = await db.query('SELECT id FROM "Bookings" WHERE id LIKE $1', [prefix + '%']);
      assert.equal(existing.rowCount, 0, 'Pending orders already exist for this day; refusing duplicates');
      const services = await db.query('SELECT id FROM "Services" WHERE id=ANY($1)', [['SEQ_TEST_SVC_60','SEQ_TEST_SVC_90']]);
      assert.equal(services.rowCount, 2, 'Both TEST services must exist');
      for (const [index, [label, serviceIds]] of cases.entries()) {
        const id = prefix + (index + 1);
        await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","timeBooking","customerName","updatedAt",source,"totalAmount",status)
          VALUES($1,$1,$2,$3,$4,now(),'STANDARD_WALK_IN',$5,'NEW')`,
          [id,day,`${String(10+index).padStart(2,'0')}:00`,'TEST ' + label,serviceIds.length * 300000]);
        for (const [itemIndex, serviceId] of serviceIds.entries())
          await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options)
            VALUES($1,$2,$3,300000,'NEW','{}'::jsonb)`,[id+'_ITEM_'+(itemIndex+1),id,serviceId]);
      }
      const check = await db.query(`SELECT b.id,b.status,count(i.id)::int AS items,count(ka.id)::int AS assignments
        FROM "Bookings" b JOIN "BookingItems" i ON i."bookingId"=b.id
        LEFT JOIN "KtvAssignments" ka ON ka.booking_id=b.id
        WHERE b.id LIKE $1 GROUP BY b.id,b.status ORDER BY b.id`,[prefix+'%']);
      assert.equal(check.rowCount, 5);
      assert.ok(check.rows.every((r,index) => r.status === 'NEW' && r.assignments === 0 && r.items === cases[index][1].length));
      await db.query('COMMIT');
      for (const [index,row] of check.rows.entries()) console.log(`${row.id} | NEW | ${cases[index][0]} | ${row.items} dịch vụ | chưa gán`);
      console.log('PASS 5 pending TEST orders on ' + day);
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  } finally { await db.end(); }
}
main().catch(error => { console.error('FAILED:',error.message); process.exitCode=1; });
