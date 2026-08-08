const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    const today = new Date().toISOString().split('T')[0];
    const { data: queues, error } = await supabase
        .from('TurnQueue')
        .select('*')
        .in('employee_id', ['NH011', 'NH027'])
        .eq('date', today);

    if (error) {
        console.error("Error:", error);
        return;
    }
    console.log("TurnQueue:");
    console.log(JSON.stringify(queues, null, 2));
    
    if (queues && queues.length > 0) {
        const orderIds = queues.map(q => q.current_order_id).filter(Boolean);
        if (orderIds.length > 0) {
             const { data: bookings } = await supabase.from('Bookings').select('id, status, billCode').in('id', orderIds);
             console.log("Bookings:");
             console.log(JSON.stringify(bookings, null, 2));
             
             const { data: items } = await supabase.from('BookingItems').select('id, status, technicianCodes').in('bookingId', orderIds);
             console.log("Items:");
             console.log(JSON.stringify(items, null, 2));
        }
    }
}

checkData();
