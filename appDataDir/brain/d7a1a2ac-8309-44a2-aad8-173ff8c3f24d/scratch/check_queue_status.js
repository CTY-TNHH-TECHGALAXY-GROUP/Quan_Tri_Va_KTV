const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkQueueStatus3004() {
    const targetCodes = ['NH002', 'NH025'];
    const { data: queue } = await supabase
        .from('TurnQueue')
        .select('*')
        .in('employee_id', targetCodes)
        .eq('date', '2026-04-30');
    
    console.log('TurnQueue status for 30/04:');
    queue?.forEach(q => {
        console.log(`- ${q.employee_id}: status=${q.status}, turns=${q.turns_completed}`);
    });
}

checkQueueStatus3004();
