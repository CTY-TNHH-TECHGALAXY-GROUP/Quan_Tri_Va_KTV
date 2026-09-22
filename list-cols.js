const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function listColumns() {
    console.log('--- BOOKINGS COLUMNS ---');
    try {
        const { data, error } = await supabase
            .from('Bookings')
            .select('*')
            .limit(1);
        
        if (error) {
            console.error('Error:', error);
            return;
        }

        if (data && data.length > 0) {
            console.log(Object.keys(data[0]).join(', '));
        } else {
            console.log('No data found to inspect columns');
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

listColumns();
