const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkCols() {
    const { data, error } = await supabase
        .from('KTVAttendance')
        .select('*')
        .eq('employeeId', 'NH001')
        .order('checkedAt', { ascending: false })
        .limit(1);
        
    if (error) {
        console.error(error);
    } else {
        console.log("KTVAttendance row for NH001:");
        console.log(data[0] ? Object.keys(data[0]) : "No data");
        console.log(JSON.stringify(data[0], null, 2));
    }
}

checkCols();
