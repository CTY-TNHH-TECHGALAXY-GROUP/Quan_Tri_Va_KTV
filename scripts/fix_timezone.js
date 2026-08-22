const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Fix NH069 directly
  const { error } = await s
    .from('TurnQueue')
    .update({ start_time: '21:34', estimated_end_time: '22:19' })
    .eq('employee_id', 'NH069')
    .eq('date', '2026-05-13');
  
  if (error) {
    console.log('Error:', error.message);
  } else {
    console.log('Updated NH069: start=21:34, end=22:19 (VN time)');
  }

  // Verify
  const { data } = await s
    .from('TurnQueue')
    .select('employee_id, start_time, estimated_end_time')
    .eq('employee_id', 'NH069')
    .eq('date', '2026-05-13')
    .single();
  console.log('Verified:', data);
})();
