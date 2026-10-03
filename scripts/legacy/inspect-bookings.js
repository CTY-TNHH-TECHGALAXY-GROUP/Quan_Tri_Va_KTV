require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectBookings() {
    console.log('--- BOOKINGS KEYS ---');
    try {
        const { data } = await supabase.from('Bookings').select().limit(1);
        if (data && data.length > 0) {
            console.log('Keys:', Object.keys(data[0]).join(', '));
            console.log('Sample IDs and Phones (DONE status):');
            const { data: doneB } = await supabase.from('Bookings').select('id, customerPhone, phone, customer_id, customerName, status').in('status', ['DONE', 'COMPLETED']).limit(5);
            console.log(JSON.stringify(doneB, null, 2));
        }
    } catch (err) {
        console.error(err);
    }
}

inspectBookings();
