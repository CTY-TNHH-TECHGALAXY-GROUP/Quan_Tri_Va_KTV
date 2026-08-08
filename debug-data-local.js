const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    console.log('--- START DIAGNOSTIC ---');
    try {
        const { data: customers } = await supabase.from('Customers').select('*').limit(3);
        console.log('Customers (Partial):', JSON.stringify(customers, null, 2));

        const { data: bookings } = await supabase.from('Bookings').select('*').limit(10);
        console.log('Bookings (Partial):', JSON.stringify(bookings, null, 2));

        if (bookings && bookings.length > 0) {
            const { data: items } = await supabase.from('BookingItems').select('*').in('bookingId', bookings.map(b => b.id));
            console.log('BookingItems for these bookings:', JSON.stringify(items, null, 2));
        }

        const { data: services } = await supabase.from('Services').select('id, nameVN, price, priceVND').limit(10);
        console.log('Services (Partial):', JSON.stringify(services, null, 2));

        // Statistics helper
        const { data: allStatuses } = await supabase.from('Bookings').select('status');
        const counts = (allStatuses || []).reduce((acc, b) => {
            acc[b.status] = (acc[b.status] || 0) + 1;
            return acc;
        }, {});
        console.log('Status breakdown in Bookings:', counts);

    } catch (err) {
        console.error('Error during diagnostic:', err);
    }
    console.log('--- END DIAGNOSTIC ---');
}

checkData();
