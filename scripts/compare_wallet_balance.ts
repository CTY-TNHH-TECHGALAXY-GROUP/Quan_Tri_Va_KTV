/**
 * Script: Kiểm tra status thực tế của các booking "thừa" trong TurnLedger
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    if (key === 'NEXT_PUBLIC_SUPABASE_URL') process.env.NEXT_PUBLIC_SUPABASE_URL = value;
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') process.env.SUPABASE_SERVICE_ROLE_KEY = value;
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkOrphanBookings() {
    // Các booking thừa trong TurnLedger mà Node.js không thấy
    const orphanIds = [
        '11NDK-010-12052026',  // NH014
        '11NDK-004-18052026',  // NH021
        '11NDK-002-21052026',  // NH021
        '11NDK-003-26052026',  // NH021
        '5a53bd8a-7a56-442e-a45b-ac64bf8db00b' // NH021
    ];

    console.log('='.repeat(70));
    console.log('🔍 KIỂM TRA STATUS THỰC TẾ CỦA CÁC BOOKING "THỪA" TRONG TurnLedger');
    console.log('='.repeat(70));

    // 1. Kiểm tra trong bảng Bookings
    for (const bookingId of orphanIds) {
        const { data: booking, error } = await supabase
            .from('Bookings')
            .select('id, status, timeStart, billCode, createdAt')
            .eq('id', bookingId)
            .maybeSingle();

        const { data: turnLedger } = await supabase
            .from('TurnLedger')
            .select('employee_id, counted_at, booking_id')
            .eq('booking_id', bookingId);

        const ktvInTL = (turnLedger || []).map(t => t.employee_id).join(', ');

        console.log(`\n📋 Booking: ${bookingId}`);
        console.log(`   TurnLedger KTV: ${ktvInTL}`);

        if (error) {
            console.log(`   ❌ DB Error: ${error.message}`);
        } else if (!booking) {
            console.log(`   ❌ KHÔNG TỒN TẠI trong bảng Bookings!`);
            console.log(`   → TurnLedger giữ "rác" - booking đã bị xóa hoặc không tồn tại.`);
        } else {
            console.log(`   Status: ${booking.status}`);
            console.log(`   TimeStart: ${booking.timeStart}`);
            console.log(`   BillCode: ${booking.billCode || 'N/A'}`);

            // Kiểm tra tại sao Node.js không thấy
            const validStatuses = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
            if (!validStatuses.includes(booking.status)) {
                console.log(`   → Node.js bỏ qua vì status = "${booking.status}" (không nằm trong [DONE, COMPLETED, CLEANING, FEEDBACK])`);
            } else {
                // Check timeStart
                const startDate = new Date(booking.timeStart);
                const globalStart = new Date('2026-05-04T00:00:00+07:00');
                if (startDate < globalStart) {
                    console.log(`   → Node.js bỏ qua vì timeStart (${booking.timeStart}) < Global Start (2026-05-04)`);
                } else {
                    console.log(`   → ⚠️ Lạ! Booking hợp lệ nhưng Node.js vẫn không thấy. Cần kiểm tra BookingItems.`);
                    
                    const { data: items } = await supabase
                        .from('BookingItems')
                        .select('id, technicianCodes, status, serviceId')
                        .eq('bookingId', bookingId);

                    if (!items || items.length === 0) {
                        console.log(`   → Booking KHÔNG CÓ BookingItems! Dữ liệu bất thường.`);
                    } else {
                        items.forEach(item => {
                            console.log(`      Item ${item.id}: techCodes=${JSON.stringify(item.technicianCodes)} status=${item.status}`);
                        });
                    }
                }
            }
        }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log('📝 KẾT LUẬN: Nếu booking bị HỦY hoặc KHÔNG TỒN TẠI mà TurnLedger');
    console.log('   vẫn giữ → SQL RPC tính THỪA tiền (sai). Node.js đúng vì nó');
    console.log('   chỉ tính các booking có status hợp lệ.');
    console.log('='.repeat(70));
}

checkOrphanBookings().catch(err => { console.error('Fatal:', err); process.exit(1); });
