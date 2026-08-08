const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:nganhaspa2026@db.adzfohfdindovfcpaizb.supabase.co:5432/postgres' });
client.connect().then(() => {
  return client.query("ALTER TABLE \"public\".\"TaskCategories\" ADD COLUMN IF NOT EXISTS \"repeat_mode\" text DEFAULT 'DAILY';");
}).then(() => {
  return client.query('NOTIFY pgrst;');
}).then(() => {
  console.log('Added repeat_mode to TaskCategories!');
  process.exit(0);
}).catch(console.error);