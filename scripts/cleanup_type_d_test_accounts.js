const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log('Cleaning up test users...');
    const targetCodes = ['T001','T011','T014','T016','T018','T021','T025','T027','T069','T079','T002'];
    
    for (const code of targetCodes) {
        // Find auth user ID and delete from auth.users (if any)
        const { data: user } = await supabase.from('Users').select('id, auth_user_id').eq('code', code).single();
        if (user && user.auth_user_id) {
            const { error: authErr } = await supabase.auth.admin.deleteUser(user.auth_user_id);
            if (authErr) console.log(`Warning: Could not delete auth user for ${code}: ${authErr.message}`);
            else console.log(`Deleted auth user for ${code}`);
        }
        
        // Delete from public.Users
        const { error } = await supabase.from('Users').delete().eq('code', code);
        if (error) {
            console.error(`Failed to delete ${code}:`, error.message);
        } else {
            console.log(`Deleted ${code} from Users table.`);
        }
    }
}
run();
