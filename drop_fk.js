const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'C:/Users/ADMIN/OneDrive/Desktop/Ngan Ha/Quan_Tri_Va_KTV/.env.local';
const env = fs.readFileSync(envPath, 'utf-8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function run() {
  const query = `
    ALTER TABLE "public"."Tasks" DROP CONSTRAINT IF EXISTS "Tasks_assignee_id_fkey";
  `;
  const { data, error } = await supabase.rpc('exec_sql', { sql: query });
  
  if (error && error.code === 'PGRST202') {
     console.log('Need psql or direct postgres connection to drop constraint. Will create a migration.');
  } else {
     console.log('Result:', data, error);
  }
}
run();
