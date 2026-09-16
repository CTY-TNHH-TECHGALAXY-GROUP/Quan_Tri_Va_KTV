import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvWalletService } from './lib/services/KtvWalletService';

dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const staffId = 'T001';
    
    // 1. Insert mock data
    const mockBookings = [
        {
            id: 'BKG-001',
            timeStart: '2026-08-31T00:00:00.000Z',
            status: 'COMPLETED',
            rating: 5,
            BookingItems: [{
                serviceId: 'NHT0003', // VIP
                technicianCodes: [staffId],
                segments: JSON.stringify([
                    { id: 'S1', ktvId: staffId, duration: 30, actualStartTime: '2026-08-31T00:00:00Z', actualEndTime: '2026-08-31T00:30:00Z' },
                    { id: 'S2', ktvId: staffId, duration: 30, actualStartTime: '2026-08-31T00:30:00Z', actualEndTime: '2026-08-31T01:00:00Z' }
                ]),
                status: 'DONE',
                tip: 50000
            }]
        },
        {
            id: 'BKG-002',
            timeStart: '2026-08-31T02:00:00.000Z',
            status: 'COMPLETED',
            rating: 3,
            BookingItems: [{
                serviceId: 'NHS0020', // PT
                technicianCodes: [staffId],
                segments: [
                    { id: 'S3', ktvId: staffId, duration: 40, actualStartTime: '2026-08-31T02:00:00Z', actualEndTime: '2026-08-31T02:40:00Z' }
                ],
                status: 'DONE',
                tip: 20000
            }]
        }
    ];

    try {
        const resB = await supabase.from('Bookings').insert(mockBookings.map(b => ({
            id: b.id,
            timeStart: b.timeStart,
            status: b.status,
            rating: b.rating,
            billCode: b.id,
            updatedAt: new Date().toISOString()
        })));
        if (resB.error) console.error("Bookings insert err:", resB.error);
        
        for (const b of mockBookings) {
            const resI = await supabase.from('BookingItems').insert({
                id: b.id + '_item',
                bookingId: b.id,
                serviceId: b.BookingItems[0].serviceId,
                technicianCodes: b.BookingItems[0].technicianCodes,
                segments: b.BookingItems[0].segments,
                status: b.BookingItems[0].status,
                tip: b.BookingItems[0].tip,
                price: 0
            });
            if (resI.error) console.error("Items insert err:", resI.error);
        }

        // 2. Run Wallet Service
        const balance = await KtvWalletService.getBalance(supabase, staffId);
        console.log(JSON.stringify(balance, null, 2));
    } finally {
        await supabase.from('BookingItems').delete().in('bookingId', ['BKG-001', 'BKG-002']);
        await supabase.from('Bookings').delete().in('id', ['BKG-001', 'BKG-002']);
    }
}

run();
