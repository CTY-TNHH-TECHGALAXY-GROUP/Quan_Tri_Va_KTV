const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixQueueStatus() {
    const targetCodes = ['NH002', 'NH025'];
    
    console.log(`Updating TurnQueue status to 'off' for ${targetCodes.join(', ')} on 2026-04-30...`);
    
    const { data, error } = await supabase
        .from('TurnQueue')
        .update({ status: 'off' })
        .in('employee_id', targetCodes)
        .eq('date', '2026-04-30');
        
    if (error) {
        console.error('Error updating:', error);
    } else {
        console.log('Successfully updated status to "off".');
    }
}

fixQueueStatus();
