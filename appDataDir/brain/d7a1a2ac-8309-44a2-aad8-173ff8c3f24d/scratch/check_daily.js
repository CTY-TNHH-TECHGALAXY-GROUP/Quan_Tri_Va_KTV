const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDaily() {
    const { data: daily } = await supabase.from('DailyAttendance').select('*').eq('date', '2026-04-30');
    console.log(`Total DailyAttendance Records for 30/4: ${daily?.length || 0}`);
    if (daily) daily.forEach(d => console.log(`- ${d.employee_id}: status=${d.status}`));
}

checkDaily();
