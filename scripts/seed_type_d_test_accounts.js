const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: staffs } = await supabase.from('Staff').select('id, full_name');
    const { data: users } = await supabase.from('Users').select('code, username');
    const userCodes = new Set(users.map((u) => u.code).filter((c) => c));
    
    const missing = staffs.filter((s) => !userCodes.has(s.id) && (s.id.toLowerCase().includes('test') || s.full_name.toLowerCase().includes('test') || s.id.match(/^T\d+/)));
    
    const insertData = missing.map((m) => ({
        id: m.id, 
        username: m.id.toLowerCase(), 
        password: '123456',
        code: m.id,
        fullName: m.full_name,
        gender: 'Female', 
        isOnShift: false,
        isBusy: false,
        role: 'TECHNICIAN'
    }));

    if (insertData.length === 0) {
        console.log("No missing test users found.");
        return;
    }

    const { data, error } = await supabase.from('Users').insert(insertData).select();
    if (error) {
        console.error("Error inserting users:", error);
    } else {
        console.log(`Successfully inserted ${data.length} users.`);
    }
}
run();
