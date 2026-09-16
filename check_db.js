const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDB() {
  const today = new Date();
  today.setHours(today.getHours() + 7); // VN Time
  const todayStr = today.toISOString().split('T')[0];

  console.log(`\n=== 🔎 TÌM KIẾM CÁC ĐƠN HÀNG HÔM NAY (${todayStr}) ===\n`);

  const { data: bookings, error: bErr } = await supabase
    .from('Bookings')
    .select(`
      id, billCode, status, timeBooking, parent_booking_id, sub_suffix,
      BookingItems!fk_bookingitems_booking (
        id, serviceId, status, roomName, bedId, technicianCodes, options
      )
    `)
    .order('createdAt', { ascending: false })
    .limit(15);

  if (bErr) {
    console.error("❌ Lỗi lấy Bookings:", bErr);
    return;
  }

  for (const b of bookings) {
    console.log(`\n📦 BOOKING: ${b.billCode} | ID: ${b.id} | Status: ${b.status} | Parent: ${b.parent_booking_id} | Suffix: ${b.sub_suffix}`);
    for (const item of b.BookingItems) {
      console.log(`   - 🛠 ITEM: ${item.serviceId} | Status: ${item.status} | KTVs: ${item.technicianCodes} | Room: ${item.roomName} - Bed: ${item.bedId}`);
      if (item.options) {
        let opts = item.options;
        if (typeof opts === 'string') {
           try { opts = JSON.parse(opts); } catch (e) {}
        }
        if (opts.mergedIntoId) {
          console.log(`     👉 MERGED INTO: ${opts.mergedIntoId}`);
        }
      }
    }
  }
}

checkDB();
