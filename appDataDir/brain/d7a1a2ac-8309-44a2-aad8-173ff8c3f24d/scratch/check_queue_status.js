const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
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
