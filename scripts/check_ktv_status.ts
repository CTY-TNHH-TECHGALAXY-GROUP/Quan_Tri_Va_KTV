import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log("Date:", today);
    
    // Check TurnQueue
    const { data: turns, error: turnsErr } = await supabase
        .from('TurnQueue')
        .select('*')
        .in('employee_id', ['NH002', 'NH011'])
        .eq('date', today);
        
    console.log("TurnQueue:", turns, turnsErr);
    
    // Check Bookings
    const { data: bookings, error: bookingsErr } = await supabase
        .from('Bookings')
        .select('id, billCode, status, timeStart, timeEnd')
        .ilike('billCode', '%007');
        
    console.log("Bookings:", bookings, bookingsErr);
    
    if (bookings && bookings.length > 0) {
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, bookingId, status, segments, technicianCodes')
            .eq('bookingId', bookings[0].id);
        console.log("BookingItems:", JSON.stringify(items, null, 2));
    }
}

main().catch(console.error);
