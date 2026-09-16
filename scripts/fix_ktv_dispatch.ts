import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
    const today = new Date();
    // Chỉnh giờ VN (nhưng lấy UTC string the date split để test)
    const vnOffsetMs = 7 * 60 * 60 * 1000;
    const vnTime = new Date(today.getTime() + vnOffsetMs);
    if (vnTime.getUTCHours() < 6) {
        vnTime.setUTCDate(vnTime.getUTCDate() - 1);
    }
    const businessDate = vnTime.toISOString().split('T')[0];

    const bookingId = `TEST-${Math.random().toString(36).substring(2, 9)}`;
    await supabase.from('Bookings').insert({
        id: bookingId,
        billCode: `BILL-${Math.random().toString(36).substring(2, 9)}`,
        source: 'STANDARD_WALK_IN',
        status: 'NEW',
        updatedAt: new Date().toISOString(),
        customerName: 'KhAch Test GTp',
        totalAmount: 500000,
        bookingDate: new Date().toISOString(),
        timeBooking: '12:00'
    });
    
    const { data: services } = await supabase.from('Services').select('id, nameVN, duration').limit(2);
    
    const item1Id = `ITEM-${Math.random().toString(36).substring(2, 9)}`;
    const item2Id = `ITEM-${Math.random().toString(36).substring(2, 9)}`;
    
    await supabase.from('BookingItems').insert([
        { id: item1Id, bookingId, serviceId: services[0].id, price: 100000, status: 'PREPARING', roomName: 'P1', segments: JSON.stringify([{ktvId: 'NH079', startTime: '12:00', endTime: '13:00', duration: services[0].duration}]) },
        { id: item2Id, bookingId, serviceId: services[1].id, price: 100000, status: 'PREPARING', roomName: 'P1', segments: JSON.stringify([{ktvId: 'NH079', startTime: '13:00', endTime: '14:00', duration: services[1].duration}]) }
    ]);
    
    const guestId = `GUEST-${Math.random().toString(36).substring(2, 9)}`;
    await supabase.from('BookingGuests').insert({
        id: guestId, booking_id: bookingId, guest_index: 1, guest_label: 'KhAch 1', status: 'IN_PROGRESS'
    });
    
    await supabase.from('BookingItems').update({ guest_id: guestId, technicianCodes: ['NH079'] }).eq('id', item1Id);
    await supabase.from('BookingItems').update({ guest_id: guestId, technicianCodes: ['NH079'], options: JSON.stringify({ mergedIntoId: item1Id }) }).eq('id', item2Id);
    
    const { error: tErr } = await supabase.from('TurnQueue').update({
        status: 'assigned',
        current_order_id: bookingId,
        booking_item_ids: [item1Id, item2Id],
        start_time: '12:00:00',
        estimated_end_time: '14:00:00'
    }).eq('employee_id', 'NH079').eq('date', businessDate);
    if (tErr) console.error(tErr);
    
    console.log('Done fix script!');
}
fix();
