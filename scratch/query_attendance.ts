import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const today = new Date().toISOString().split('T')[0];
    
    console.log('Fetching for date:', today);

    // Fetch user UUID for NH014
    const { data: user, error: userErr } = await supabase
        .from('Users')
        .select('id, code, fullName')
        .eq('code', 'NH014')
        .single();
        
    if(userErr) {
        console.error('User fetch error:', userErr);
    }
    
    let userUuid = user ? user.id : 'NH014'; // Fallback

    const { data: attendance, error: err1 } = await supabase
        .from('KTVAttendance')
        .select('*')
        .eq('employeeId', userUuid)
        .gte('date', today);
        
    console.log('--- KTVAttendance ---');
    console.log(attendance);
    if(err1) console.error(err1);
    
    const { data: turn, error: err2 } = await supabase
        .from('TurnQueue')
        .select('*')
        .eq('employee_id', 'NH014')
        .gte('date', today);
        
    console.log('\n--- TurnQueue ---');
    console.log(turn);
    if(err2) console.error(err2);
    
    const { data: daily, error: err3 } = await supabase
        .from('DailyAttendance')
        .select('*')
        .eq('employee_id', 'NH014')
        .gte('date', today);
        
    console.log('\n--- DailyAttendance ---');
    console.log(daily);
    if(err3) console.error(err3);
}
run();
