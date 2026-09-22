import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllStatus() {
    const { data: bookings, error } = await supabase.from('Bookings').select('id, timeStart, billCode, status, BookingItems:BookingItems!fk_bookingitems_booking(technicianCodes)')
        .gte('timeStart', '2026-05-14T17:00:00.000Z') // Bao trùm ngày 15/05
        .lte('timeStart', '2026-05-16T17:00:00.000Z');
        
    if (error) throw error;
    
    const valid = bookings.filter(b => b.BookingItems && b.BookingItems.some(i => i.technicianCodes && i.technicianCodes.some(tc => tc.toLowerCase() === 'nh001')));
    console.log("Toàn bộ các đơn hàng của NH001 vào ngày 15/05 (Bất kể trạng thái):");
    valid.forEach(b => {
        console.log(`+ ${b.timeStart}: ${b.billCode} (Status: ${b.status})`);
    });
}

checkAllStatus().catch(console.error);
