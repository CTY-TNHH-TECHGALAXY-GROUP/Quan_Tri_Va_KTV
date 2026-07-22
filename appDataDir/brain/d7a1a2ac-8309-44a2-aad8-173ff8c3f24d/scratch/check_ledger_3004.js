const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
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
