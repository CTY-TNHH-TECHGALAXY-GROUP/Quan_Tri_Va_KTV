const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'C:/Users/ADMIN/OneDrive/Desktop/Ngan Ha/Quan_Tri_Va_KTV/.env.local';
const env = fs.readFileSync(envPath, 'utf-8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function run() {
  const { error } = await supabase.rpc('execute_sql', {
    sql_string: `
      ALTER TABLE "Tasks" DROP CONSTRAINT "Tasks_assignee_id_fkey";
      ALTER TABLE "Tasks" ADD CONSTRAINT "Tasks_assignee_id_fkey" FOREIGN KEY (assignee_id) REFERENCES "Users"(id) ON DELETE CASCADE;
    `
  });
  if (error) {
    console.log("Failed via RPC:", error.message);
  } else {
    console.log("Success via RPC");
  }
}

run();
