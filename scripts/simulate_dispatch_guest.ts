import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function simulate() {
    console.log("🚀 Bắt đầu tạo đơn mô phỏng...");
    
    // 1. Tạo Booking ảo
    const { data: booking, error: bErr } = await supabase.from('Bookings').insert({
        id: `TEST-${Math.random().toString(36).substring(2, 9)}`,
        billCode: `BILL-${Math.random().toString(36).substring(2, 9)}`,
        source: 'STANDARD_WALK_IN',
        status: 'NEW',
        updatedAt: new Date().toISOString(),
        customerName: 'Khách Test Gộp',
        totalAmount: 500000,
        bookingDate: new Date().toISOString(),
        timeBooking: '12:00'
    }).select().single();
    
    if (bErr) throw bErr;
    console.log("✅ Tạo Booking thành công:", booking.id);

    // 2. Lấy 2 dịch vụ có sẵn (ví dụ Ráy Tai và Đắp Mặt)
    const { data: services } = await supabase.from('Services').select('id, nameVN, duration').limit(2);
    if (!services || services.length < 2) throw new Error("Không đủ 2 dịch vụ trong DB");
    
    // 3. Tạo 2 BookingItems ảo (Khách mua 2 dịch vụ)
    const item1 = {
        id: `ITEM-${Math.random().toString(36).substring(2, 9)}`,
        bookingId: booking.id,
        serviceId: services[0].id,
        price: 100000,
        status: 'PREPARING',
        roomName: 'P1',
        segments: JSON.stringify([{ktvId: "NH079", startTime: "12:00", endTime: "13:00", duration: services[0].duration}])
    };
    const item2 = {
        id: `ITEM-${Math.random().toString(36).substring(2, 9)}`,
        bookingId: booking.id,
        serviceId: services[1].id,
        price: 100000,
        status: 'PREPARING',
        roomName: 'P1',
        segments: JSON.stringify([{ktvId: "NH079", startTime: "13:00", endTime: "14:00", duration: services[1].duration}])
    };
    
    const { data: insertedItems, error: iErr } = await supabase.from('BookingItems').insert([item1, item2]).select();
    if (iErr) throw iErr;
    
    console.log("✅ Tạo 2 BookingItems thành công:", insertedItems.map(i => i.id));
    
    // 4. Lễ Tân thao tác gộp đơn: Item 2 được gộp vào Item 1 (options: mergedIntoId)
    const targetItem = insertedItems[0];
    const sourceItem = insertedItems[1];
    
    console.log(`🔗 Khách hàng mua 2 dịch vụ, tạo 1 BookingGuests chung...`);
    
    // 4. Tạo BookingGuests
    const { data: newGuest, error: gErr } = await supabase.from('BookingGuests').insert({
        id: `GUEST-${Math.random().toString(36).substring(2, 9)}`,
        booking_id: booking.id,
        guest_index: 1,
        guest_label: 'Khách 1',
        status: 'IN_PROGRESS'
    }).select('id').single();
    if (gErr) throw gErr;
    console.log(`👤 Tạo mới BookingGuest thành công: ${newGuest.id}`);
    
    // 5. Cập nhật guest_id và options cho 2 items
    const sourceOptions = { mergedIntoId: targetItem.id };
    const targetOptions = { 
        mergedServiceIds: [sourceItem.id],
        displayName: `${services[0].nameVN} + ${services[1].nameVN}`
    };
    await supabase.from('BookingItems').update({ guest_id: newGuest.id, options: JSON.stringify(targetOptions) }).eq('id', targetItem.id);
    await supabase.from('BookingItems').update({ guest_id: newGuest.id, options: JSON.stringify(sourceOptions) }).eq('id', sourceItem.id);
    
    // 6. Cập nhật KTV cho 2 items thành NH079
    const segments0 = JSON.stringify([{ktvId: "NH079", startTime: "12:00", endTime: "13:00", duration: services[0].duration}]);
    const segments1 = JSON.stringify([{ktvId: "NH079", startTime: "13:00", endTime: "14:00", duration: services[1].duration}]);
    
    await supabase.from('BookingItems').update({ technicianCodes: ["NH079"], segments: segments0 }).eq('id', targetItem.id);
    await supabase.from('BookingItems').update({ technicianCodes: ["NH079"], segments: segments1 }).eq('id', sourceItem.id);
    
    // 7. Tạo TurnQueue cho KTV
    await supabase.from('TurnQueue').insert({
        employee_id: 'NH079',
        date: new Date().toISOString().split('T')[0],
        status: 'assigned',
        current_order_id: booking.id,
        booking_item_ids: [targetItem.id, sourceItem.id],
        start_time: '12:00:00',
        estimated_end_time: '14:00:00'
    });
    
    console.log("✅ Đã tạo TurnQueue cho NH079!");
    
    // 8. Kiểm tra lại DB
    const { data: finalItems } = await supabase.from('BookingItems').select('id, guest_id, technicianCodes, segments').eq('bookingId', booking.id);
    console.log("📊 KẾT QUẢ BookingItems trong DB:");
    console.table(finalItems);
    
    const { data: finalGuests } = await supabase.from('BookingGuests').select('*').eq('booking_id', booking.id);
    console.log("📊 KẾT QUẢ BookingGuests trong DB:");
    console.table(finalGuests);
    
}

simulate().catch(console.error);
