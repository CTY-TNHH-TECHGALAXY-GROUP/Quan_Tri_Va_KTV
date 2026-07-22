require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data } = await supabase.from('Users').select('id, username, code').limit(5);
    console.log('Users:', data);
    const { data: staff } = await supabase.from('Staff').select('id, full_name').limit(5);
    console.log('Staff:', staff);
}
run();
