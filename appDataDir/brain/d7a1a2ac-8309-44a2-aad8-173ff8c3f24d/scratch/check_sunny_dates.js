const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSunnyDates() {
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, billCode, bookingDate, status')
        .in('id', ['11NDK-001-30042026', '11NDK-005-30042026', '11NDK-008-30042026', '11NDK-010-30042026']);
    
    console.log('Bookings for Sunny on 30/04:');
    bookings.forEach(b => console.log(`- ${b.billCode}: date=${b.bookingDate}, status=${b.status}`));
}

checkSunnyDates();
