const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase
    .from('Bookings')
    .select('id, billCode, customerName, customerPhone, customerEmail, nationality, source, bookingDate, timeBooking, notes');
    
  if (error) {
    console.error(error);
    return;
  }
  
  let combined = data.filter(b => {
    let isBookingSource = ['STANDARD_BOOKING', 'VIP_BOOKING', 'MIXED_BOOKING', 'BOOKING_WALK_IN'].includes(b.source);
    let isWebSource = b.source === 'WEB_BOOKING';
    let isWebNote = b.notes && typeof b.notes === 'string' && b.notes.includes('WEB_ADVANCE_BOOKING');
    return isBookingSource || isWebSource || isWebNote;
  });
  
  console.log('Total bookings combined:', combined.length);
  
  let md = '| Ngu?n ghi nh?n | Mã Bill | Tên Khách Hàng | S? Ði?n Tho?i | Email | Ngày Ð?t | Gi? H?n |\n';
  md += '|---|---|---|---|---|---|---|\n';
  
  combined.sort((a, b) => new Date(b.bookingDate || 0) - new Date(a.bookingDate || 0));
  
  combined.forEach(b => {
    let bDate = b.bookingDate ? new Date(b.bookingDate).toLocaleDateString('vi-VN') : '';
    let type = b.source;
    if (b.notes && typeof b.notes === 'string' && b.notes.includes('WEB_ADVANCE_BOOKING')) {
        type += ' <br>*(Web Advance)*';
    }
    let name = b.customerName || 'N/A';
    let phone = b.customerPhone || 'N/A';
    let email = b.customerEmail || 'N/A';
    md += '| ' + type + ' | ' + (b.billCode || b.id) + ' | ' + name + ' | ' + phone + ' | ' + email + ' | ' + bDate + ' | ' + (b.timeBooking || '') + ' |\n';
  });
  
  fs.writeFileSync('C:/Users/ADMIN/.gemini/antigravity/brain/ce96a3b3-0bdc-4c5c-91da-e679a40378c9/danh_sach_khach_hang.md', md);
  console.log('Updated list');
}
run();
