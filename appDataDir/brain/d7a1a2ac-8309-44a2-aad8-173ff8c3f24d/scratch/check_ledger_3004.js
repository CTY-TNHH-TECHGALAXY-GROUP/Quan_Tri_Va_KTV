require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLedger() {
    const { data: ledger } = await supabase
        .from('TurnLedger')
        .select('*')
        .eq('date', '2026-04-30');
    
    console.log('Ledger entries for 30/04:');
    ledger.forEach(l => console.log(`- ${l.employee_id}: ${l.booking_id} (Source: ${l.source})`));
}

checkLedger();
