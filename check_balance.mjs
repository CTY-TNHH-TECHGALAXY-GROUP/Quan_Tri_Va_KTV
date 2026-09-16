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

async function checkBalanceAPI() {
    const techCode = 'NH001';
    const GLOBAL_START_DATE_STR = '2026-05-04';
    const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';

    const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
    const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
    const todayStr = nowVnDate.toISOString().split('T')[0];

    const { data: ledgers } = await supabase
        .from('KTVDailyLedger')
        .select('date, total_commission')
        .eq('staff_id', techCode)
        .gte('date', GLOBAL_START_DATE_STR);

    let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;
    let ledgerSummaryComm = 0;

    const pastLedgers = ledgers.filter(l => l.date < todayStr);
    
    if (pastLedgers.length > 0) {
        let maxDateStr = pastLedgers[0].date;
        pastLedgers.forEach(l => {
            if (l.date > maxDateStr) maxDateStr = l.date;
            ledgerSummaryComm += Number(l.total_commission);
        });
        const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
        const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
        realtimeStartStr = nextDateVn.toISOString().split('T')[0] + 'T00:00:00+07:00';
    }

    const { data: bookings } = await supabase.from('Bookings').select('id, timeStart, status, billCode, createdAt, BookingItems:BookingItems!fk_bookingitems_booking(technicianCodes, serviceId, segments)').gte('timeStart', realtimeStartStr).in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);
    const { data: services } = await supabase.from('Services').select('id, duration');
    const svcDurationMap = {};
    services.forEach(s => { svcDurationMap[s.id] = s.duration || 60; });

    let rt_commission = 0;
    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);
    validBookings.forEach(b => {
        const relevantItems = b.BookingItems.filter(i => i.technicianCodes && i.technicianCodes.some(tc => tc.toLowerCase().includes(techCode.toLowerCase())));
        if (relevantItems.length === 0) return;
        let totalDuration = 0;
        for (const item of relevantItems) {
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            const mySegs = segs.filter(seg => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));
            if (mySegs.length > 0) {
                totalDuration += mySegs.reduce((sum, seg) => sum + (getMinsFromTimes(seg.startTime, seg.endTime) || Number(seg.duration) || 0), 0);
            } else totalDuration += svcDurationMap[String(item.serviceId)] || 60;
        }
        rt_commission += calcCommission(totalDuration || 60, { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 }, 100000);
    });

    const { data: adjustments } = await supabase.from('WalletAdjustments').select('amount').eq('staff_id', techCode).gte('created_at', GLOBAL_START_DATE_ISO);
    const total_adjustment = (adjustments || []).reduce((sum, a) => sum + Number(a.amount), 0);

    const { data: withdrawals } = await supabase.from('KTVWithdrawals').select('amount, status').eq('staff_id', techCode).gte('request_date', GLOBAL_START_DATE_ISO);
    const total_withdrawn = (withdrawals || []).filter(w => w.status === 'APPROVED').reduce((sum, w) => sum + Math.abs(Number(w.amount)), 0);

    const total_commission = ledgerSummaryComm + rt_commission;
    const gross_income = total_commission + total_adjustment;
    const net_balance = gross_income - total_withdrawn;

    console.log("=== BALANCE API SIMULATION ===");
    console.log("Today String:", todayStr);
    console.log("Ledger Comm (upto 29/05):", ledgerSummaryComm);
    console.log("Realtime Comm (from 30/05):", rt_commission);
    console.log("Total Comm:", total_commission);
    console.log("Total Adjustment:", total_adjustment);
    console.log("Total Withdrawn:", total_withdrawn);
    console.log("Gross Income:", gross_income);
    console.log("NET BALANCE:", net_balance);
}

checkBalanceAPI().catch(console.error);
