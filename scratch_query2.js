const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAudit() {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
        .from('SecurityAuditLogs')
        .select('*')
        .eq('employee_id', 'NH001')
        .order('created_at', { ascending: false })
        .limit(10);
        
    if (error) {
        console.error("Error SecurityAuditLogs:", error);
    } else {
        console.log("SecurityAuditLogs NH001:", JSON.stringify(data, null, 2));
    }
}

checkAudit();
