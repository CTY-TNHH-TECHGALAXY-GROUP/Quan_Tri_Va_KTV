const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:nganhaspa2026@db.adzfohfdindovfcpaizb.supabase.co:5432/postgres' });
client.connect().then(() => {
  return client.query('ALTER TABLE "public"."TaskTemplates" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;');
}).then(() => {
  return client.query('ALTER TABLE "public"."Tasks" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;');
}).then(() => {
  return client.query('NOTIFY pgrst;');
}).then(() => {
  console.log('Migration applied and schema reloaded!');
  process.exit(0);
}).catch(console.error);
