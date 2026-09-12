const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // Get the test users we just inserted
    const { data: users } = await supabase.from('Users')
        .select('id, username')
        .in('id', ['T014', 'T025', 'T001', 'T069', 'T027', 'T002', 'T021', 'T079', 'T016', 'T018', 'T011']);

    if (!users || users.length === 0) {
        console.log("No users found to update.");
        return;
    }

    let successCount = 0;
    for (const u of users) {
        const { error } = await supabase.from('Users')
            .update({ username: u.id.toUpperCase() }) // Make username uppercase
            .eq('id', u.id);
            
        if (error) {
            console.error(`Error updating ${u.id}:`, error);
        } else {
            successCount++;
        }
    }
    
    console.log(`Successfully updated ${successCount} users to uppercase usernames.`);
}
run();
