const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

const bookingId = '507d91c1-af0d-4635-aa52-678521b7a3ba';

// Logic helper tương tự createNotification trong lib/notification-helper.ts
async function createNotification(payload) {
    const { error } = await supabase
        .from('StaffNotifications')
        .insert({
            type: payload.type,
            message: payload.message,
            employeeId: payload.employeeId || null,
            bookingId: payload.bookingId || null,
            isRead: false,
        });
    if (error) console.error("❌ Notification error:", error);
}

async function simulateConfirmWebBooking() {
    console.log(`🚀 [Simulation] Starting confirmation for booking: ${bookingId}...`);
    try {
        // 1. Fetch booking current details (like in confirmWebBooking)
        const { data: bData, error: fetchErr } = await supabase
            .from('Bookings')
            .select('source, technicianCode, roomName, bedId, billCode')
            .eq('id', bookingId)
            .single();

        if (fetchErr) throw fetchErr;

        let newSource = 'STANDARD_WALK_IN';
        if (bData.source === 'VIP_BOOKING') newSource = 'VIP_WALK_IN';

        // 2. Cập nhật booking status = 'NEW' và source (Duyệt đơn)
        const { error: updateErr } = await supabase
            .from('Bookings')
            .update({
                source: newSource,
                updatedAt: new Date().toISOString(),
            })
            .eq('id', bookingId)
            .eq('status', 'NEW');

        if (updateErr) throw updateErr;
        console.log(`✅ [Simulation] Booking status updated. Source mapped to: ${newSource}`);

        // 3. Thông báo cho quầy
        const msg = `Đơn ${bookingId} đã được xác nhận. Vui lòng vào Điều Phối để phân công KTV.`;
        await createNotification({
            bookingId: bookingId,
            type: 'NEW_ORDER',
            message: msg,
        });
        console.log(`✅ [Simulation] General NEW_ORDER notification sent to Reception.`);

        // 4. Thông báo cho KTV yêu cầu (NH000)
        if (bData.technicianCode) {
            const techList = bData.technicianCode.split(',').map(t => t.trim()).filter(Boolean);
            const locationInfo = `Phòng ${bData.roomName || '???'}${bData.bedId ? ` - Giường ${bData.bedId.split('-').pop()}` : ''}`;
            
            for (const techCode of techList) {
                const ktvMsg = `Bạn có đơn yêu cầu mới #${bData.billCode || bookingId} tại ${locationInfo}`;
                
                await createNotification({
                    bookingId: bookingId,
                    employeeId: techCode,
                    type: 'KTV_NEW_ORDER',
                    message: ktvMsg,
                });
                console.log(`✅ [Simulation] Specific KTV_NEW_ORDER notification sent to KTV: ${techCode}`);
            }
        }

        console.log("\n⏳ [Simulation] Waiting 2 seconds for database sync...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 5. Query các thông báo của đơn này để đối chiếu
        const { data: finalNotifs } = await supabase
            .from('StaffNotifications')
            .select('*')
            .eq('bookingId', bookingId)
            .order('createdAt', { ascending: true });

        console.log("\n🔔 [Simulation] Final notifications in database for this booking:");
        console.log(JSON.stringify(finalNotifs, null, 2));

    } catch (err) {
        console.error("❌ [Simulation] Error during simulation:", err);
    }
}

simulateConfirmWebBooking();
