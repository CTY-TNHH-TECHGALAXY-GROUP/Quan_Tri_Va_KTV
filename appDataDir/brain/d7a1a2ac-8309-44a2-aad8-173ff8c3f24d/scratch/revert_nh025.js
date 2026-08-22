const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function revertNH025QueueStatus() {
    console.log(`Reverting TurnQueue status to 'waiting' for NH025 on 2026-04-30...`);
    
    const { data, error } = await supabase
        .from('TurnQueue')
        .update({ status: 'waiting' })
        .eq('employee_id', 'NH025')
        .eq('date', '2026-04-30');
        
    if (error) {
        console.error('Error updating:', error);
    } else {
        console.log('Successfully reverted NH025 status to "waiting".');
    }
}

revertNH025QueueStatus();
