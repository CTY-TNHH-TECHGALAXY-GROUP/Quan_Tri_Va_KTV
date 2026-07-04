import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) supabaseKey = line.split('=')[1].trim();
});

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBooking() {
    const bookingId = '11NDK-004-04072026';
    const { data: booking } = await supabase.from('Bookings').select('*').eq('billCode', bookingId).single();
    console.log('Booking:', booking);
    
    // Sometimes booking_id in TurnLedger is actually the ID in Bookings, not billCode
    const actualBookingId = booking ? booking.id : bookingId;

    const { data: b } = await supabase.from('Bookings').select('*').eq('id', actualBookingId).single();
    console.log('Bookings:', b);

    const { data: items } = await supabase.from('BookingItems').select('*').eq('bookingId', actualBookingId);
    console.log('BookingItems:', JSON.stringify(items, null, 2));
}
checkBooking();
