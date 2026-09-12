const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envFile = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
envFile.split('\n').forEach(line => {
  const [key, ...value] = line.split('=');
  if (key && value.length > 0) {
    envVars[key.trim()] = value.join('=').trim().replace(/['"]/g, '');
  }
});

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = envVars['SUPABASE_SERVICE_ROLE_KEY']; 
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

async function run() {
  const bookingId = '11NDK-005-24052026';
  
  console.log('--- Booking 11NDK-005-24052026 ---');
  const { data: booking } = await supabase.from('Bookings').select('*').eq('id', bookingId);
  console.log(JSON.stringify(booking, null, 2));

  console.log('--- BookingItems for 11NDK-005-24052026 ---');
  const { data: items } = await supabase.from('BookingItems').select('*').eq('bookingId', bookingId);
  console.log(JSON.stringify(items, null, 2));
}

run();
