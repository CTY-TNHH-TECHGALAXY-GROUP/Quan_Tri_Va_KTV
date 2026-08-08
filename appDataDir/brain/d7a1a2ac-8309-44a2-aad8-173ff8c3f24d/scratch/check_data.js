const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDate(date) {
    console.log(`--- Checking data for ${date} ---`);
    
    // 1. TurnQueue
    const { data: queue } = await supabase
        .from('TurnQueue')
        .select('*')
        .eq('date', date);
    
    console.log(`\n[TurnQueue] Count: ${queue?.length || 0}`);
    if (queue) {
        queue.forEach(q => {
            console.log(`- ${q.employee_id}: status=${q.status}, turns=${q.turns_completed}`);
        });
    }

    // 2. TurnLedger
    const { data: ledger } = await supabase
        .from('TurnLedger')
        .select('*')
        .eq('date', date);
    
    console.log(`\n[TurnLedger] Count: ${ledger?.length || 0}`);
    if (ledger) {
        const counts = {};
        ledger.forEach(l => {
            counts[l.employee_id] = (counts[l.employee_id] || 0) + 1;
        });
        console.log('Counts:', counts);
    }
}

checkDate('2026-04-30');
