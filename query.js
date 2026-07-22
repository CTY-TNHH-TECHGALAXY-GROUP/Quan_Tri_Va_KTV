require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.from('BookingItems').select('id, price, options, serviceName').order('id', { ascending: false }).limit(10);
  console.log(JSON.stringify(data, null, 2));
}
run();
