require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function describeOrder() {
  const billCode = 'TEST-260818-9WP8';
  console.log('=== TRUY XUẤT ĐƠN', billCode, 'VÀ CÁC ĐƠN CON ===');
  
  // 1. Lấy tất cả Bookings liên quan (Gốc và các đơn con)
  const { data: bookings } = await supabase.from('Bookings').select('*').ilike('billCode', `%${billCode}%`);
  if (!bookings || bookings.length === 0) {
      console.log('Không tìm thấy đơn hàng nào!');
      return;
  }
  
  for (const b of bookings) {
      console.log(`\n--- ĐƠN: ${b.billCode} (ID: ${b.id}) ---`);
      console.log(`- Khách hàng: ${b.customerName} (${b.guestCount} khách)`);
      console.log(`- Trạng thái: ${b.status}`);
      
      // 2. Lấy BookingGuests
      const { data: guests } = await supabase.from('BookingGuests').select('*').eq('booking_id', b.id);
      console.log(`- Hồ sơ khách (BookingGuests): ${guests?.length || 0} bản ghi`);
      (guests || []).forEach(g => {
          console.log(`  > Guest ID: ${g.id.substring(0,8)} | Label: ${g.guest_label}`);
      });
      
      // 3. Lấy BookingItems
      const { data: items } = await supabase.from('BookingItems').select('*').eq('bookingId', b.id);
      console.log(`- Dịch vụ (BookingItems): ${items?.length || 0} bản ghi`);
      (items || []).forEach(i => {
          console.log(`  > Item: ${i.serviceName} (${i.duration}m)`);
          console.log(`    ID: ${i.id}`);
          console.log(`    KTV: ${i.technicianCodes?.join(', ') || 'None'}`);
          console.log(`    Merged Into: ${i.options?.mergedIntoId || 'None'}`);
          console.log(`    Merged Children: ${i.options?.mergedServiceIds?.join(', ') || 'None'}`);
          console.log(`    Guest ID: ${i.guest_id ? i.guest_id.substring(0,8) : 'null'}`);
          let segs = [];
          try { segs = typeof i.segments === 'string' ? JSON.parse(i.segments) : (i.segments || []); } catch(e) {}
          if (segs.length > 0) {
              segs.forEach((s, idx) => {
                  console.log(`    [Seg ${idx+1}] KTV: ${s.ktvId}, Dur: ${s.duration}m, Start: ${s.startTime}, End: ${s.endTime}`);
                  if (s.actualStartTime || s.actualEndTime) {
                      console.log(`      Actual: ${s.actualStartTime} -> ${s.actualEndTime}`);
                  }
              });
          }
      });
  }
}
describeOrder();
