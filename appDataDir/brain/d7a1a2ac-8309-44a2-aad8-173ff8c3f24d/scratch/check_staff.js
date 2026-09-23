require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStaff() {
    const { data: staff } = await supabase.from('Staff').select('id, full_name').eq('status', 'ĐANG LÀM');
    console.log(`Total Active Staff: ${staff?.length || 0}`);
    staff.forEach(s => console.log(`- ${s.id}: ${s.full_name}`));
}

checkStaff();
