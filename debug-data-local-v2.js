const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    console.log('--- START DIAGNOSTIC V2 ---');
    try {
        // 1. Check Services
        const { data: services, error: sError } = await supabase.from('Services').select('id, nameVN, price, priceVND');
        if (sError) console.error('Services Error:', sError);
        console.log(`Services Count: ${services ? services.length : 0}`);
        if (services && services.length > 0) {
            console.log('Service Sample:', JSON.stringify(services[0], null, 2));
        }

        // 2. Check Completed Bookings and their Phones
        const { data: doneBookings, error: bError } = await supabase
            .from('Bookings')
            .select('id, customerPhone, status')
            .in('status', ['COMPLETED', 'DONE', 'FEEDBACK']);
        
        if (bError) console.error('Bookings Error:', bError);
        console.log('Done Bookings:', JSON.stringify(doneBookings, null, 2));

        // 3. Check Customers and their Phones
        const { data: customers, error: cError } = await supabase.from('Customers').select('id, fullName, phone');
        if (cError) console.error('Customers Error:', cError);
        console.log(`Customers Count: ${customers ? customers.length : 0}`);
        
        if (doneBookings && customers) {
            const customerPhones = new Set(customers.map(c => c.phone));
            const matches = doneBookings.filter(b => customerPhones.has(b.customerPhone));
            console.log(`Found ${matches.length} matches between Bookings and Customers phone numbers.`);
            
            if (matches.length === 0 && doneBookings.length > 0) {
                console.log('Mismatch Example:');
                console.log('  Customer Phone Sample:', customers[0]?.phone);
                console.log('  Booking Phone Sample:', doneBookings[0]?.customerPhone);
            }
        }

    } catch (err) {
        console.error('Error during diagnostic:', err);
    }
    console.log('--- END DIAGNOSTIC V2 ---');
}

checkData();
