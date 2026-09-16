const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

(async () => {
    const techCode = 'NH007';

    const milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
    const ratePer60 = 100000;

    const START_DATE = '2026-05-04T00:00:00.000Z';
    const timeline = [];

    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, timeStart, timeEnd, status, technicianCode, billCode, createdAt, BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip )')
        .gte('timeStart', START_DATE)
        .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);

    const { data: services } = await supabase.from('Services').select('id, duration');
    const svcDurationMap = {};
    (services || []).forEach(s => { svcDurationMap[String(s.id)] = s.duration || 60; });

    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

    for (const b of validBookings) {
        const relevantItems = (b.BookingItems || []).filter(i =>
            i.technicianCodes &&
            Array.isArray(i.technicianCodes) &&
            i.technicianCodes.some(tc => tc.toLowerCase().includes(techCode.toLowerCase()))
        );

        if (relevantItems.length === 0) continue;

        let totalDuration = 0;
        for (const item of relevantItems) {
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }

            const mySegs = segs.filter(seg => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));

            if (mySegs.length > 0) {
                totalDuration += mySegs.reduce((sum, seg) => {
                    const realMins = getMinsFromTimes(seg.startTime, seg.endTime);
                    if (realMins > 0) return sum + realMins;
                    return sum + (Number(seg.duration) || 0);
                }, 0);
            } else {
                totalDuration += svcDurationMap[String(item.serviceId)] || 60;
            }
        }

        const commission = calcCommission(totalDuration || 60, milestones, ratePer60);
        if (commission > 0) {
            timeline.push({
                id: b.id + '_comm',
                type: 'COMMISSION',
                title: 'Tiền tua đơn ' + (b.billCode || b.id.substring(0,6)),
                amount: commission,
                note: 'Tổng thời gian: ' + totalDuration + ' phút',
                created_at: b.timeStart || b.createdAt,
                status: 'APPROVED'
            });
        }
    }

    const { data: adjustments } = await supabase
        .from('WalletAdjustments')
        .select('id, amount, reason, type, created_at')
        .eq('staff_id', techCode)
        .gte('created_at', START_DATE);
    
    (adjustments || []).forEach(a => {
        timeline.push({
            id: a.id,
            type: Number(a.amount) >= 0 ? 'GIFT' : 'ADJUSTMENT',
            title: Number(a.amount) >= 0 ? 'Thưởng hệ thống' : 'Trừ tiền hệ thống',
            amount: a.amount,
            note: a.reason || '',
            created_at: a.created_at,
            status: 'APPROVED'
        });
    });

    timeline.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    let currentBalance = 0;
    timeline.forEach(item => {
        if (item.type !== 'TIP' && item.status !== 'REJECTED') {
            currentBalance += Number(item.amount);
        }
        item.running_balance = currentBalance;
    });

    timeline.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.log(timeline);
})();
