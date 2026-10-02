import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
(async () => {
    const ktv = 'NH079';
    for (const date of ['2026-08-17', '2026-08-27']) {
        console.log('--- DATE:', date, '---');
        const start = date + 'T00:00:00+07:00';
        const end = date + 'T23:59:59+07:00';
        const res = await s.from('Bookings').select('id, rating, bookingDate, timeStart, BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, duration )').gte('bookingDate', start).lte('bookingDate', end);
        const bks = (res.data || []).filter(b => b.BookingItems.some(i => i.technicianCodes?.includes(ktv)));
        console.log('Bookings for', ktv, ':', bks.length);
        for (const b of bks) {
            console.log('Booking:', b.id, 'status:', b.status);
            for (const i of b.BookingItems.filter(i => i.technicianCodes?.includes(ktv))) {
                console.log('  Item:', i.id, 'svc:', i.serviceId, 'status:', i.status);
                console.log('  segments:', JSON.stringify(i.segments));
            }
        }
    }
    process.exit(0);
})();
