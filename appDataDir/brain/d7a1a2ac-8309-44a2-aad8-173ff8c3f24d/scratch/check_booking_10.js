require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBooking10() {
    const { data: items } = await supabase
        .from('BookingItems')
        .select('*')
        .eq('bookingId', '11NDK-010-30042026');
    
    console.log('Items for 11NDK-010-30042026:');
    items.forEach(i => console.log(`- ${i.id}: ${JSON.stringify(i.technicianCodes)}`));
}

checkBooking10();
