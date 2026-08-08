const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function finalCheck() {
    console.log('--- FINAL LINKAGE CHECK ---');
    try {
        const { data: doneB, error: bError } = await supabase
            .from('Bookings')
            .select('id, customerId, customerName, customerPhone, totalAmount, status')
            .in('status', ['DONE', 'COMPLETED']);
        
        if (bError) console.error('Booking Error:', bError.message);
        console.log('Done Bookings:', JSON.stringify(doneB, null, 2));

        if (doneB && doneB.length > 0) {
            const customerIds = doneB.map(b => b.customerId).filter(Boolean);
            if (customerIds.length > 0) {
                const { data: customers } = await supabase.from('Customers').select('id, fullName, phone').in('id', customerIds);
                console.log('Matched Customers by ID:', JSON.stringify(customers, null, 2));
            } else {
                console.log('No customerId values found in done bookings.');
            }

            const customerPhones = doneB.map(b => b.customerPhone).filter(Boolean);
            if (customerPhones.length > 0) {
                const { data: customersByPhone } = await supabase.from('Customers').select('id, fullName, phone').in('phone', customerPhones);
                console.log('Matched Customers by Phone:', JSON.stringify(customersByPhone, null, 2));
            } else {
                console.log('No customerPhone values found in done bookings.');
            }
        }
    } catch (err) {
        console.error(err);
    }
}

finalCheck();
