const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function findColumns() {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`);
        const data = await response.json();
        
        // This usually returns OpenAPI spec which has schema definition
        let found = [];
        if (data && data.definitions) {
            for (const [tableName, tableDef] of Object.entries(data.definitions)) {
                if (tableDef.properties) {
                    const cols = Object.keys(tableDef.properties);
                    if (cols.includes('device_id') || cols.includes('deviceId') || cols.includes('ip_address') || cols.includes('ipAddress') || cols.includes('wifi_ip')) {
                        found.push({ table: tableName, cols: cols.filter(c => ['device_id', 'deviceId', 'ip_address', 'ipAddress', 'wifi_ip'].includes(c)) });
                    }
                }
            }
        }
        console.log("Tables with requested columns:", found);
    } catch(e) {
        console.error(e);
    }
}
findColumns();
