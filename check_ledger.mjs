import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

const calcCommission = (durationMins, milestones, ratePer60) => {
    const sMins = String(durationMins);
    if (milestones && milestones[sMins] !== undefined) {
        return Number(milestones[sMins]);
    }
    const h = durationMins / 60;
    const comm = Math.round(h * ratePer60);
    return Math.round(comm / 1000) * 1000;
};

const getMinsFromTimes = (start, end) => {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let mins1 = h1 * 60 + m1;
    let mins2 = h2 * 60 + m2;
    if (mins2 < mins1) mins2 += 24 * 60;
    return mins2 - mins1;
};

async function checkLedger() {
    console.log("Đang phân tích dữ liệu Sổ cái (Ledger) vs Tính trực tiếp từ Đơn (Bookings) của NH001...");
    
    // 1. Lấy cấu hình hoa hồng
    const { data: milestoneConf } = await supabase.from('SystemConfigs').select('value').eq('key', 'ktv_commission_milestones').single();
    let milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
    if (milestoneConf?.value) { try { milestones = typeof milestoneConf.value === 'string' ? JSON.parse(milestoneConf.value) : milestoneConf.value; } catch {} }

    // 2. Lấy Ledger
    const { data: ledgers } = await supabase
        .from('KTVDailyLedger')
        .select('*')
        .eq('staff_id', 'NH001')
        .order('date', { ascending: true });

    const ledgerByDate = {};
    ledgers.forEach(l => { ledgerByDate[l.date] = l; });

    // 3. Lấy Services để lấy duration map
    const { data: services } = await supabase.from('Services').select('id, duration');
    const svcDurationMap = {};
    services.forEach(s => { svcDurationMap[s.id] = s.duration || 60; });

    // 4. Lấy tất cả Bookings có NH001 (IN_PROGRESS, DONE, FEEDBACK, CLEANING)
    // FIX FK ERROR
    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, timeStart, status, billCode, createdAt,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments )
        `)
        .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);

    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);
    const bookingCommByDate = {};

    let totalB = 0;
    let totalL = 0;

    validBookings.forEach(b => {
        const relevantItems = b.BookingItems.filter(i => 
            i.technicianCodes && Array.isArray(i.technicianCodes) && i.technicianCodes.some(tc => tc.toLowerCase().includes('nh001'))
        );
        if (relevantItems.length === 0) return;

        // Tính ngày của booking theo múi giờ VN (GIỐNG HỆT NHƯ SỔ CÁI TÍNH)
        const vnDate = new Date(new Date(b.timeStart || b.createdAt).getTime() + 7 * 60 * 60 * 1000);
        const bDateStr = vnDate.toISOString().split('T')[0];

        let totalDuration = 0;
        for (const item of relevantItems) {
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            const mySegs = segs.filter(seg => seg.ktvId && seg.ktvId.toLowerCase().includes('nh001'));

            if (mySegs.length > 0) {
                totalDuration += mySegs.reduce((sum, seg) => {
                    const realMins = getMinsFromTimes(seg.startTime, seg.endTime);
                    return sum + (realMins > 0 ? realMins : (Number(seg.duration) || 0));
                }, 0);
            } else {
                totalDuration += svcDurationMap[String(item.serviceId)] || 60;
            }
        }

        const commission = calcCommission(totalDuration || 60, milestones, 100000);
        
        if (!bookingCommByDate[bDateStr]) bookingCommByDate[bDateStr] = { totalComm: 0, count: 0, bills: [] };
        bookingCommByDate[bDateStr].totalComm += commission;
        bookingCommByDate[bDateStr].count++;
        bookingCommByDate[bDateStr].bills.push(`${b.billCode}(${commission/1000}k)`);
    });

    // 5. So sánh
    console.log("\n--- KẾT QUẢ SO SÁNH (NH001) ---");
    let hasDiff = false;
    const allDates = new Set([...Object.keys(ledgerByDate), ...Object.keys(bookingCommByDate)]);
    
    Array.from(allDates).sort().forEach(date => {
        const lComm = ledgerByDate[date]?.total_commission || 0;
        const bComm = bookingCommByDate[date]?.totalComm || 0;
        
        totalB += bComm;
        totalL += lComm;
        
        if (lComm !== bComm) {
            hasDiff = true;
            console.log(`\n❌ Ngày ${date} BỊ LỆCH:`);
            console.log(`   - Trong Sổ Cái (Ledger) ghi: ${lComm.toLocaleString()}đ`);
            console.log(`   - Thực tế từ Đơn (Bookings): ${bComm.toLocaleString()}đ`);
            console.log(`   -> Lệch: ${(lComm - bComm).toLocaleString()}đ`);
            if (bookingCommByDate[date]) {
                console.log(`   - Các đơn thực tế ngày này (${bookingCommByDate[date].count} đơn): ${bookingCommByDate[date].bills.join(', ')}`);
            }
        }
    });

    console.log(`\nTỔNG LỆCH: ${(totalL - totalB).toLocaleString()}đ`);

    if (!hasDiff) {
        console.log("\n✅ KHÔNG PHÁT HIỆN LỆCH GIỮA SỔ CÁI VÀ ĐƠN HÀNG TRONG LỊCH SỬ!");
        console.log("Nếu vẫn lệch 50k, có thể lỗi nằm ở Realtime hoặc mốc cắt ngày hôm nay.");
    }
}

checkLedger().catch(console.error);
