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

async function checkTotalFromMay4() {
    let allBookings = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
        const { data, error } = await supabase.from('Bookings').select('id, timeStart, billCode, status, createdAt, BookingItems:BookingItems!fk_bookingitems_booking(technicianCodes, serviceId, segments)')
            .gte('timeStart', '2026-05-04T00:00:00.000Z')
            .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING'])
            .range(page * pageSize, (page + 1) * pageSize - 1);
            
        if (error) throw error;
        if (!data || data.length === 0) break;
        allBookings = allBookings.concat(data);
        page++;
    }

    const { data: ledgers } = await supabase.from('KTVDailyLedger').select('*').eq('staff_id', 'NH001').gte('date', '2026-05-04');
    let totalLedger = ledgers.reduce((sum, l) => sum + Number(l.total_commission), 0);

    let totalBooking = 0;
    const validBookings = allBookings.filter(b => b.BookingItems && b.BookingItems.length > 0);
    
    validBookings.forEach(b => {
        const relevantItems = b.BookingItems.filter(i => 
            i.technicianCodes && i.technicianCodes.some(tc => tc.toLowerCase() === 'nh001')
        );
        if (relevantItems.length === 0) return;
        
        let totalDuration = 0;
        for (const item of relevantItems) {
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            const mySegs = segs.filter(seg => seg.ktvId && seg.ktvId.toLowerCase() === 'nh001');
            if (mySegs.length > 0) {
                totalDuration += mySegs.reduce((sum, seg) => sum + (getMinsFromTimes(seg.startTime, seg.endTime) || Number(seg.duration) || 0), 0);
            } else totalDuration += 60;
        }
        totalBooking += calcCommission(totalDuration || 60, { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 }, 100000);
    });

    console.log(`Tổng Sổ Cái từ mùng 4: ${totalLedger}`);
    console.log(`Tổng Bookings từ mùng 4: ${totalBooking}`);
}

checkTotalFromMay4().catch(console.error);
