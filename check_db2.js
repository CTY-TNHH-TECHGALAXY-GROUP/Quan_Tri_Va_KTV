const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    const { data: cols, error: e2 } = await supabase.rpc('get_columns', { table_name: 'KTVLeaveRequests' });
    if (e2) {
         // Fallback to selecting 1 row to see keys
         const { data } = await supabase.from('KTVLeaveRequests').select('*').limit(1);
         if (data && data.length > 0) {
             console.log(Object.keys(data[0]));
         } else {
             // Let's force an error to see if a column exists
             const { error } = await supabase.from('KTVLeaveRequests').select('is_sudden_off').limit(1);
             console.log("Check is_sudden_off column:", error ? error.message : "Exists");
         }
    } else {
         console.log(cols);
    }
}

checkData();
