const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkDevices() {
    const { data, error } = await supabase
        .from('RegisteredDevices')
        .select('*');
        
    if (error) {
        console.error("Error RegisteredDevices:", error);
    } else {
        console.log("RegisteredDevices:", JSON.stringify(data, null, 2));
    }
}
checkDevices();
