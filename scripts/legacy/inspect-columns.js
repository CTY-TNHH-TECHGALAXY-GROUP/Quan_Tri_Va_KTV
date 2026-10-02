require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('--- SCHEMA INSPECTION ---');
    try {
        console.log('\n--- LATEST BOOKINGS ---');
        const { data: bks, error: be } = await supabase
            .from('Bookings')
            .select('id, billCode, status, rating, technicianCode, createdAt')
            .order('createdAt', { ascending: false })
            .limit(5);
        
        if (be) console.error('Error fetching bookings:', be);
        else {
            console.table(bks);
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

inspectSchema();
