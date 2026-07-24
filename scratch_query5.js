const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAuditAll() {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
        .from('SecurityAuditLogs')
        .select('*')
        .gte('created_at', today)
        .order('created_at', { ascending: false });
        
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Audit Logs today:");
        data.forEach(d => console.log(JSON.stringify(d, null, 2)));
    }
}
checkAuditAll();
