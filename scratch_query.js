const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAttendance() {
    const today = new Date().toISOString().split('T')[0];
    
    // Check all attendances today to see if there's NH001
    const { data, error } = await supabase
        .from('KTVAttendance')
        .select('*')
        .eq('date', today)
        .order('checkedAt', { ascending: false });
        
    if (error) {
        console.error(error);
        return;
    }
    
    const nh001Data = data.filter(d => d.employeeName === 'NH001' || d.employeeId === 'NH001' || d.employeeName?.includes('NH001'));
    console.log("All data today count:", data.length);
    console.log("NH001 data today:", JSON.stringify(nh001Data, null, 2));
    
    // Also check without date filter just in case
    const { data: data2 } = await supabase
        .from('KTVAttendance')
        .select('*')
        .or('employeeName.ilike.%NH001%,employeeId.eq.NH001')
        .order('checkedAt', { ascending: false })
        .limit(5);
        
    console.log("NH001 recent data:", JSON.stringify(data2, null, 2));
}

checkAttendance();
