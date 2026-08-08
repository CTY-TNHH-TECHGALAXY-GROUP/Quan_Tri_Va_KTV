import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) process.env.NEXT_PUBLIC_SUPABASE_URL = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) process.env.SUPABASE_SERVICE_ROLE_KEY = line.split('=')[1].trim();
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkKTVs() {
    const ktvs = ['NH025', 'NH021', 'NH011', 'NH027'];
    const today = '2026-07-04';

    console.log(`Checking orders for ${ktvs.join(', ')} on ${today}\n`);

    const { data: ledgers } = await supabase
        .from('KTVDailyLedger')
        .select('*')
        .in('staff_id', ktvs)
        .eq('date', today);

    console.log('--- DAILY LEDGER ---');
    if (ledgers && ledgers.length > 0) {
        ledgers.forEach(l => {
            console.log(`- ${l.staff_id}: ${l.total_commission}đ | Bonus: ${l.total_bonus} | Tip: ${l.total_tip}`);
        });
    }

    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, billCode, status, timeStart,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, status, itemRating, tip )
        `)
        .gte('timeStart', `${today}T00:00:00+07:00`)
        .lte('timeStart', `${today}T23:59:59+07:00`);

    if (bookings) {
        ktvs.forEach(ktv => {
            console.log(`\n--- TUA CỦA ${ktv} ---`);
            let count = 0;
            
            bookings.forEach(b => {
                if (!b.BookingItems) return;
                const ktvItems = (b.BookingItems as any[]).filter((i: any) => {
                    let codes = i.technicianCodes;
                    if (typeof codes === 'string') {
                        try { codes = JSON.parse(codes); } catch { codes = []; }
                    }
                    if (!Array.isArray(codes)) codes = [codes];
                    return codes.some((c: string) => typeof c === 'string' && c.includes(ktv));
                });
                
                if (ktvItems.length > 0) {
                    count++;
                    ktvItems.forEach(i => {
                        console.log(`Mã Bill: ${b.billCode || b.id}`);
                        console.log(`  Giờ: ${b.timeStart}`);
                        console.log(`  Booking Status: ${b.status} | Item Status: ${i.status}`);
                        console.log(`  Rating: ${i.itemRating !== null ? i.itemRating : 'Chưa rate'} | Tip: ${i.tip || 0}`);
                    });
                }
            });
            
            if (count === 0) console.log('Chưa có tua nào.');
        });
    }
}
checkKTVs();
