
const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.adzfohfdindovfcpaizb:KldSnHk8nggpuhpS@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
async function run() {
  await client.connect();
  console.log('Connected to DB');
  const res = await client.query('ALTER TABLE "Services" ADD COLUMN IF NOT EXISTS "showGender" boolean DEFAULT true, ADD COLUMN IF NOT EXISTS "showStrength" boolean DEFAULT true, ADD COLUMN IF NOT EXISTS "showFocus" boolean DEFAULT true;');
  console.log('ALTER TABLE SUCCESS');
  await client.end();
}
run();

