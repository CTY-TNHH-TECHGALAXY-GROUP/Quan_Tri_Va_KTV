const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const client = new Client({
    connectionString: process.env.DIRECT_URL
  });
  
  try {
    await client.connect();
    
    console.log('\n--- 1. Constraint đã mở ---');
    const res1 = await client.query(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'check_work_type';`);
    console.table(res1.rows);
    
    console.log('\n--- 2. Bảng mới đã có ---');
    const res2 = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('KTVServiceHoursLedger', 'KTVMonthlyServiceHours');`);
    console.table(res2.rows);
    
    console.log('\n--- 3. Seed thành công ---');
    const res3 = await client.query(`SELECT id, full_name, work_type, work_type_effective_from FROM "Staff" WHERE id LIKE 'T%' ORDER BY id;`);
    console.table(res3.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

run();
