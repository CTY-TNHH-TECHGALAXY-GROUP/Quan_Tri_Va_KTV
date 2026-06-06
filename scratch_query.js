const fs = require('fs');
const fileContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
fileContent.split(/\r?\n/).forEach(line => {
  const eqIdx = line.indexOf('=');
  if (eqIdx !== -1) {
    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.substring(1, val.length - 1);
    }
    env[key] = val;
  }
});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkSpecificBooking() {
  const { data: booking } = await supabase
    .from('Bookings')
    .select('*')
    .eq('id', '11NDK-006-06062026')
    .single();
  console.log('Booking 11NDK-006-06062026 details:');
  console.log(JSON.stringify(booking, null, 2));

  const { data: notif } = await supabase
    .from('StaffNotifications')
    .select('*')
    .eq('bookingId', '11NDK-006-06062026');
  console.log('Notifications for this booking:');
  console.log(JSON.stringify(notif, null, 2));
}

checkSpecificBooking().catch(console.error);
