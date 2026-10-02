const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
    const { data: staff } = await supabase.from('Staff').select('*').ilike('id', '%079%').single();
    if (staff) {
        console.log('Found staff:', staff.id);
        const { error } = await supabase.from('KTVLeaveRequests').delete().eq('employeeId', staff.id);
        console.log('Deleted old leaves for', staff.id, error);
    }
}
cleanup().then(() => process.exit(0));
