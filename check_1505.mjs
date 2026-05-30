import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function get1505Bookings() {
    let allBookings = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
        const { data, error } = await supabase.from('Bookings').select('id, timeStart, billCode, status, BookingItems:BookingItems!fk_bookingitems_booking(technicianCodes, serviceId, segments)')
            .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING'])
            .range(page * pageSize, (page + 1) * pageSize - 1);
            
        if (error) throw error;
        if (!data || data.length === 0) break;
        allBookings = allBookings.concat(data);
        page++;
    }
    
    const validBookings = allBookings.filter(b => b.BookingItems && b.BookingItems.some(i => i.technicianCodes && i.technicianCodes.some(tc => tc.toLowerCase() === 'nh001')));
    
    console.log(`NH001 có: ${validBookings.length} đơn hàng trong tháng.`);
    
    const may15Bookings = validBookings.filter(b => b.timeStart && b.timeStart.startsWith('2026-05-15'));
    console.log(`Các đơn hàng của NH001 trong ngày 15/05:`);
    may15Bookings.forEach(b => {
        console.log(`+ ${b.timeStart}: ${b.billCode} (${b.status})`);
        const myItems = b.BookingItems.filter(i => i.technicianCodes.some(tc => tc.toLowerCase() === 'nh001'));
        console.log(`  Items:`, JSON.stringify(myItems));
    });
}

get1505Bookings().catch(console.error);
