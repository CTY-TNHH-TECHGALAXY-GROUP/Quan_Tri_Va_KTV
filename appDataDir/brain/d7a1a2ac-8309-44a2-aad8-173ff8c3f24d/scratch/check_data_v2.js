const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

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
        console.log('Counts in Ledger:', counts);
    }
}

checkDate('2026-04-30');
