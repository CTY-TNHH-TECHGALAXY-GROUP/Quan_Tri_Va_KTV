require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('--- SCHEMA INSPECTION V2 ---');
    try {
        const { data: bData } = await supabase.from('Bookings').select().limit(1);
        if (bData && bData.length > 0) {
            console.log('Bookings Columns:', Object.keys(bData[0]).join(', '));
            console.log('Bookings Sample:', JSON.stringify(bData[0], null, 2));
        }

        const { data: sData } = await supabase.from('Services').select().limit(1);
        if (sData && sData.length > 0) {
            console.log('Services Columns:', Object.keys(sData[0]).join(', '));
            console.log('Services Sample:', JSON.stringify(sData[0], null, 2));
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

inspectSchema();
