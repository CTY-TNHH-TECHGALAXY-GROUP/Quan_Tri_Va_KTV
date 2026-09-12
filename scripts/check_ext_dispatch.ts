import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // Find the booking from the screenshot: S260722-0VGC
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, billCode, status, technicianCode, notes')
        .ilike('billCode', '%0VGC%')
        .limit(5);
    
    console.log('Bookings matching 0VGC:');
    bookings?.forEach(b => {
        console.log(`  ${b.id}: billCode=${b.billCode}, status=${b.status}, techCode=${b.technicianCode}`);
    });

    if (bookings && bookings.length > 0) {
        const bookingId = bookings[0].id;
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, bookingId, technicianCodes, options, status, segments')
            .eq('bookingId', bookingId);
        
        console.log(`\nBookingItems for booking ${bookingId}:`);
        items?.forEach(item => {
            const opts = typeof item.options === 'string' ? JSON.parse(item.options) : item.options;
            console.log(`\n  Item ${item.id}:`);
            console.log(`    technicianCodes: ${JSON.stringify(item.technicianCodes)}`);
            console.log(`    status: ${item.status}`);
            console.log(`    external_technician_name: ${JSON.stringify(opts?.external_technician_name)}`);
            console.log(`    segments: ${JSON.stringify(item.segments)}`);
        });

        // Also check TurnQueue/KtvAssignments
        const { data: assignments } = await supabase
            .from('KtvAssignments')
            .select('*')
            .eq('bookingId', bookingId);
        console.log(`\nKtvAssignments:`, assignments);

        const { data: turnQueue } = await supabase
            .from('TurnQueue')
            .select('employee_id, current_order_id, status')
            .eq('current_order_id', bookingId);
        console.log(`\nTurnQueue for this booking:`, turnQueue);
    } else {
        // Search today's bookings
        const { data: todayBookings } = await supabase
            .from('Bookings')
            .select('id, billCode, status, date')
            .eq('date', '2026-07-22')
            .order('created_at', { ascending: false })
            .limit(10);
        console.log('\nToday bookings:', todayBookings?.map(b => `${b.billCode} (${b.status})`));
    }
}
run();
