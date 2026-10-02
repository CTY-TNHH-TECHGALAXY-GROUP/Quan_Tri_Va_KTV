require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('--- SCHEMA INSPECTION V3 ---');
    try {
        const tables = ['Rooms', 'Beds', 'TurnQueue', 'Staff'];
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*').limit(1);
            if (error) {
                console.error(`Error fetching ${table}:`, error.message);
            } else if (data && data.length > 0) {
                console.log(`${table} Columns:`, Object.keys(data[0]).join(', '));
                console.log(`${table} First Row Sample:`, JSON.stringify(data[0], null, 2));
            } else {
                console.log(`${table} is EMPTY or not found.`);
            }
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

inspectSchema();
