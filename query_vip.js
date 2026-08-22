const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^"/, '').replace(/"$/, '');
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // 1. Get all bookings in July with COMPLETED, FEEDBACK, CLEANING, DONE status
    const validStatuses = ['COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE'];
    const { data: bookings, error } = await supabase
        .from('Bookings')
        .select('id, createdAt, source, technicianCode, status')
        .gte('createdAt', '2026-07-01T00:00:00Z')
        .lt('createdAt', '2026-08-01T00:00:00Z')
        .in('status', validStatuses);

    if (error) {
        console.error("Error fetching Bookings:", error);
        return;
    }
    
    // 2. Get all BookingItems for these bookings
    const bookingIds = bookings.map(b => b.id);
    const { data: items, error: itemError } = await supabase
        .from('BookingItems')
        .select('id, bookingId, serviceId, technicianCodes, status')
        .in('bookingId', bookingIds);
        
    if (itemError) {
         console.error("Error fetching items:", itemError);
         return;
    }
    
    // 3. Filter VIP bookings
    // A booking is VIP if source contains 'VIP' OR has a service with ID 'NHS0800'
    const vipBookings = bookings.filter(b => {
        const isVipSource = b.source && b.source.toUpperCase().includes('VIP');
        const hasVipService = items.some(i => i.bookingId === b.id && i.serviceId === 'NHS0800');
        return isVipSource || hasVipService;
    });

    console.log(`Tìm thấy ${vipBookings.length} đơn VIP đã hoàn thành trong tháng 7.\n`);
    if (vipBookings.length === 0) return;
    
    // 4. Group by Day and then by KTV
    const summaryByDate = {}; 
    
    for (const booking of vipBookings) {
        const dateObj = new Date(booking.createdAt);
        const tzDate = new Date(dateObj.getTime() + 7 * 60 * 60 * 1000);
        const day = String(tzDate.getUTCDate()).padStart(2, '0');
        const month = String(tzDate.getUTCMonth() + 1).padStart(2, '0');
        const dateStr = `${day}/${month}`;
        
        const relatedItems = items.filter(i => i.bookingId === booking.id);
        const ktvs = new Set();
        
        if (booking.technicianCode) ktvs.add(booking.technicianCode);
        
        for (const item of relatedItems) {
            // Also item needs to be completed? 
            // The prompt says "trạng thái hoàn thành nữa", probably meaning the booking is completed.
            if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                item.technicianCodes.forEach(code => ktvs.add(code));
            }
        }
        
        if (!summaryByDate[dateStr]) {
            summaryByDate[dateStr] = {};
        }
        
        for (const ktv of ktvs) {
            if (!summaryByDate[dateStr][ktv]) {
                summaryByDate[dateStr][ktv] = 0;
            }
            summaryByDate[dateStr][ktv]++;
        }
    }
    
    // 5. Output the result
    const sortedDates = Object.keys(summaryByDate).sort((a,b) => {
        const [d1] = a.split('/');
        const [d2] = b.split('/');
        return parseInt(d1) - parseInt(d2); 
    });
    
    let report = "--- BÁO CÁO SỐ LƯỢNG ĐƠN VIP (ĐÃ HOÀN THÀNH) THÁNG 7 ---\n\n";
    
    for (const date of sortedDates) {
        report += `📅 Ngày ${date}:\n`;
        const ktvs = summaryByDate[date];
        const sortedKtvs = Object.entries(ktvs).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        
        let dailyTotal = 0;
        for (const [ktv, count] of sortedKtvs) {
            report += `  - KTV ${ktv}: ${count} đơn VIP\n`;
            dailyTotal += count;
        }
        report += `  => Tổng cộng: ${dailyTotal} (Theo nhân viên)\n\n`;
    }
    
    fs.writeFileSync('vip_report_july.txt', report);
    console.log("Đã xuất báo cáo ra file vip_report_july.txt");
    console.log(report);
}

run();
