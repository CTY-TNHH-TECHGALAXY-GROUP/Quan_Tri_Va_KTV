const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'C:/Users/ADMIN/OneDrive/Desktop/Ngan Ha/Quan_Tri_Va_KTV/.env.local';
const env = fs.readFileSync(envPath, 'utf-8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.from('Staff').select('*').limit(1);
  if (error) {
    console.log("Error:", error.message);
  } else {
    console.log("Staff Columns:");
    if (data.length > 0) {
      console.log(Object.keys(data[0]));
    } else {
      console.log("Table is empty, can't infer columns from select *");
    }
  }
}

run();
