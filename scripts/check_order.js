const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) envVars[key.trim()] = val.join('=').trim();
});
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Lấy booking mới nhất (S260429-K23F)
  const bookingId = 'S260429-K23F';
  
  // Try finding by billCode
  const { data: bookings } = await supabase
    .from('Bookings')
    .select('id, billCode')
    .like('billCode', '%K23F%')
    .limit(1);
  
  const bid = bookings?.[0]?.id;
  console.log('Booking ID:', bid);
  
  if (!bid) {
    // Try with full ID search
    const { data: all } = await supabase
      .from('Bookings')
      .select('id, billCode')
      .gte('bookingDate', '2026-04-29 23:00:00')
      .order('createdAt', { ascending: false })
      .limit(5);
    console.log('Recent bookings:', all?.map(b => `${b.id} = ${b.billCode}`));
    return;
  }

  // BookingItems
  const { data: items, error: iErr } = await supabase
    .from('BookingItems')
    .select('*')
    .eq('bookingId', bid);

  if (iErr) console.log('Items error:', iErr.message);
  
  for (const item of (items || [])) {
    console.log('\n=== BookingItem ===');
    console.log('ID:', item.id);
    console.log('Service duration:', item.duration, 'min');
    console.log('technicianCodes:', JSON.stringify(item.technicianCodes));
    
    let segs = [];
    try {
      segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []);
    } catch(e) {}
    
    console.log('Segments count:', segs.length);
    segs.forEach((s, i) => {
      console.log(`  [${i}] ktvId=${s.ktvId} | start=${s.startTime} | end=${s.endTime} | duration=${s.duration}`);
    });
  }

  // TurnQueue for this booking
  const { data: turns } = await supabase
    .from('TurnQueue')
    .select('employee_id, start_time, estimated_end_time, status')
    .or(`current_order_id.eq.${bid}`)
    .eq('date', '2026-04-29');

  console.log('\n=== TurnQueue ===');
  (turns || []).forEach(t => {
    console.log(`  ${t.employee_id}: start=${t.start_time} end=${t.estimated_end_time} status=${t.status}`);
  });
}

run();
