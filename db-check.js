const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnv() {
    const envPath = path.join(__dirname, '.env.local');
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            let value = match[2] || '';
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            env[match[1]] = value;
        }
    });
    return env;
}

async function run() {
    try {
        const env = loadEnv();
        const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
        
        console.log("🔍 Checking Users table...");
        const { data, count, error } = await supabase
            .from('Users')
            .select('*', { count: 'exact' });
        
        if (error) {
            console.error("❌ DB Error:", error);
            return;
        }

        console.log(`✅ Users Count: ${count}`);
        console.log("✅ Data:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("❌ Script Error:", e.message);
    }
}

run();
