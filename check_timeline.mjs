import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTimelineData() {
    console.log("Đang phân tích lý do tại sao Timeline UI lại có Số dư = 265,000đ...");
    
    // 3. Fetch Bookings (chứa NH001) - Không phân biệt hoa thường
    const { data: bookings, error } = await supabase.from('Bookings').select('id, timeStart, billCode, status, BookingItems:BookingItems!fk_bookingitems_booking(technicianCodes, serviceId, segments)').in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);
    
    if (error) {
        console.error("Lỗi fetch bookings:", error);
        return;
    }

    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.some(i => i.technicianCodes && i.technicianCodes.some(tc => tc.toLowerCase() === 'nh001')));

    console.log("\n--- TÓM TẮT ĐƠN HÀNG CỦA NH001 (Không phân biệt hoa/thường) ---");
    console.log(`- Tổng số Bookings (Đơn hàng): ${validBookings.length}`);
    let i = 0;
    validBookings.forEach(b => {
        if(i < 5) console.log(`  + ${b.timeStart}: ${b.billCode} (${b.status})`);
        i++;
    });

}

checkTimelineData().catch(console.error);
