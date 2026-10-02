require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
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
