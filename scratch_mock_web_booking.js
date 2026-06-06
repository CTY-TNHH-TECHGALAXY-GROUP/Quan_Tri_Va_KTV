const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function simulateWebBooking() {
    console.log("🚀 [Simulation] Starting web booking simulation...");
    try {
        // 1. Lấy 1 dịch vụ ngẫu nhiên từ Services
        const { data: services, error: sErr } = await supabase
            .from('Services')
            .select('id, nameVN, priceVND')
            .eq('isActive', true)
            .limit(5);

        if (sErr) throw sErr;
        if (!services || services.length === 0) throw new Error("No active services found.");

        const selectedService = services[0];
        console.log(`📌 [Simulation] Selected Service: ${selectedService.nameVN} (${selectedService.priceVND.toLocaleString()}đ)`);

        // 2. Chọn 1 KTV ngẫu nhiên đang điểm danh hoặc có sẵn trong Staff
        const { data: staff, error: stErr } = await supabase
            .from('Staff')
            .select('id, full_name')
            .eq('status', 'ĐANG LÀM')
            .limit(5);
        
        if (stErr) throw stErr;
        const requestedKtv = staff.find(s => s.id === 'NH079') || staff[0] || { id: 'NH079', full_name: 'KTV Test' };
        console.log(`📌 [Simulation] Selected requested KTV: ${requestedKtv.full_name} (${requestedKtv.id})`);

        // 3. Tạo Bill Code
        const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '').substring(2);
        const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
        const billCode = `S${todayStr}-${randomStr}`;

        // 4. Insert Booking
        const bookingId = crypto.randomUUID();
        const { data: booking, error: bErr } = await supabase
            .from('Bookings')
            .insert({
                id: bookingId,
                billCode: billCode,
                customerName: "Khách Đặt Web Giả Lập",
                customerPhone: "0999999999",
                bookingDate: new Date().toISOString(),
                timeBooking: "14:00",
                totalAmount: selectedService.priceVND,
                status: 'NEW',
                source: 'WEB_BOOKING',
                technicianCode: requestedKtv.id, // KTV yêu cầu
                paymentMethod: 'Tiền mặt',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
            .select()
            .single();

        if (bErr) throw bErr;
        console.log(`✅ [Simulation] Booking created successfully:`);
        console.log({
            id: booking.id,
            billCode: booking.billCode,
            customerName: booking.customerName,
            source: booking.source,
            technicianCode: booking.technicianCode,
            status: booking.status
        });

        // 5. Insert BookingItem
        const itemId = crypto.randomUUID();
        const { data: item, error: iErr } = await supabase
            .from('BookingItems')
            .insert({
                id: itemId,
                bookingId: bookingId,
                serviceId: selectedService.id,
                quantity: 1,
                price: selectedService.priceVND
            })
            .select()
            .single();

        if (iErr) throw iErr;
        console.log(`✅ [Simulation] BookingItem created successfully:`);
        console.log({
            id: item.id,
            bookingId: item.bookingId,
            serviceId: item.serviceId,
            price: item.price
        });

        // 6. Check if trigger automatically created NEW_ORDER notification
        console.log("\n⏳ [Simulation] Waiting 2 seconds for triggers to run...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        const { data: notifs } = await supabase
            .from('StaffNotifications')
            .select('*')
            .eq('bookingId', bookingId);
        
        console.log("🔔 [Simulation] Notifications created in DB for this booking:");
        console.log(notifs);

    } catch (err) {
        console.error("❌ [Simulation] Error during simulation:", err);
    }
}

simulateWebBooking();
