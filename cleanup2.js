const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: staff } = await supabase.from('Staff').select('id').ilike('id', '%079%').single();
    if (staff) {
        console.log('Found staff:', staff.id);
        const { error, data } = await supabase.from('KTVLeaveRequests').delete().eq('employeeId', staff.id).select();
        console.log('Deleted rows:', data);
    }
}
run().catch(console.error);
