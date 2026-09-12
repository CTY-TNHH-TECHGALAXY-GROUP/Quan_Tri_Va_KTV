const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data: staffList } = await supabase.from('Staff').select('id, gender').in('work_type', ['TYPE_D']);
    if (!staffList) return;
    
    for (const staff of staffList) {
        if (!staff.gender) continue;
        await supabase.from('Users').update({ gender: staff.gender }).eq('id', staff.id);
        console.log(`Updated ${staff.id} gender to ${staff.gender}`);
    }
}
run();
