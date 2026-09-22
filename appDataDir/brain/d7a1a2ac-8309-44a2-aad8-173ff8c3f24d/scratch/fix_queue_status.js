const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
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
