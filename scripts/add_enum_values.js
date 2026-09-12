const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres.adzfohfdindovfcpaizb:KldSnHk8nggpuhpS@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
  });
  
  await client.connect();
  console.log('Connected to DB');
  
  const values = ['PREPARING', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
  
  for (const val of values) {
    try {
      await client.query(`ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS '${val}'`);
      console.log(`✅ ${val}: Added`);
    } catch (e) {
      console.log(`⚠️ ${val}: ${e.message}`);
    }
  }
  
  // Verify
  const res = await client.query(`SELECT unnest(enum_range(NULL::"BookingStatus")) as val`);
  console.log('\nAll enum values:', res.rows.map(r => r.val));
  
  await client.end();
}

run();
