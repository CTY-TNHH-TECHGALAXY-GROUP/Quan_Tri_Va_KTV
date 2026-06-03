import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function simulateBonusTimeline(techCode) {
    console.log(`\n======================================================`);
    console.log(`🚀 MÔ PHỎNG TIẾN ĐỘ VÍ BONUS CHO KTV: ${techCode}`);
    console.log(`======================================================\n`);

    const START_DATE = '2026-06-01';

    // 1. Fetch Earned
    const { data: earns } = await supabase
        .from('KTVDailyLedger')
        .select('date, total_bonus, staff_id')
        .eq('staff_id', techCode)
        .gte('date', START_DATE)
        .gt('total_bonus', 0)
        .order('date', { ascending: false });

    // 2. Fetch Adjustments (GIFT/PENALTY)
    const { data: adjs } = await supabase
        .from('WalletAdjustments')
        .select('created_at, amount, type, reason')
        .eq('staff_id', techCode)
        .eq('wallet_type', 'BONUS')
        .gte('created_at', `${START_DATE}T00:00:00+07:00`);

    // 3. Fetch Withdrawals (REDEEM)
    const { data: wths } = await supabase
        .from('KTVWithdrawals')
        .select('request_date, amount, status')
        .eq('staff_id', techCode)
        .eq('wallet_type', 'BONUS')
        .gte('request_date', `${START_DATE}T00:00:00+07:00`);

    const nowVn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayStr = nowVn.toISOString().split('T')[0];

    const { data: configs } = await supabase
        .from('SystemConfigs')
        .select('key, value')
        .in('key', ['ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus', 'holiday_shift2_dates']);

    const configMap = {};
    (configs || []).forEach(c => { configMap[c.key] = c.value; });
    
    const s1Bonus = Number(configMap['ktv_shift_1_bonus'] || 20);
    const s2Bonus = Number(configMap['ktv_shift_2_bonus'] || 20);
    const s3Bonus = Number(configMap['ktv_shift_3_bonus'] || 40);

    const { data: shiftsData } = await supabase
        .from('KTVShifts')
        .select('effectiveFrom, shiftType')
        .eq('employeeId', techCode)
        .lte('effectiveFrom', todayStr)
        .in('status', ['ACTIVE', 'REARRANGED', 'REPLACED'])
        .order('effectiveFrom', { ascending: true })
        .order('createdAt', { ascending: true });

    let currentShift = 'SHIFT_1';
    for (const s of (shiftsData || [])) {
        if (s.effectiveFrom <= todayStr) currentShift = s.shiftType;
    }

    let basePointsForShift = s1Bonus;
    if (currentShift === 'SHIFT_2') basePointsForShift = s2Bonus;
    else if (currentShift === 'SHIFT_3') basePointsForShift = s3Bonus;

    // 5. Fetch Realtime Bookings for today
    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, timeStart, timeEnd, status, technicianCode, rating, billCode,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, itemRating )
        `)
        .gte('timeStart', `${todayStr}T00:00:00+07:00`)
        .in('status', ['DONE', 'FEEDBACK', 'CLEANING']);

    const timeline = [];

    (bookings || []).forEach(b => {
        const bRating = Number(b.rating) || 0;
        const maxItemRating = Math.max(...(b.BookingItems || []).map((i) => Number(i.itemRating) || 0), 0);
        const bookingRating = Math.max(bRating, maxItemRating);

        if (bookingRating >= 4) {
            let isInvovled = false;
            const allKtvCodes = new Set();
            for (const item of (b.BookingItems || [])) {
                if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                    item.technicianCodes.forEach(tc => {
                        allKtvCodes.add(tc.toLowerCase());
                        if (tc.toLowerCase() === techCode.toLowerCase()) isInvovled = true;
                    });
                }
            }
            
            if (isInvovled) {
                let totalDuration = 0;
                for (const item of (b.BookingItems || [])) {
                    let segs = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
                    
                    const mySegs = segs.filter(seg => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));
                    if (mySegs.length > 0) {
                        totalDuration += mySegs.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);
                    } else if (item.technicianCodes && item.technicianCodes.some(tc => tc.toLowerCase() === techCode.toLowerCase())) {
                        totalDuration += 60; // Fallback
                    }
                }

                let adjustedBasePoints = basePointsForShift;
                if (totalDuration < 60) adjustedBasePoints = adjustedBasePoints / 2;
                const bonusPts = Math.floor(adjustedBasePoints / (allKtvCodes.size || 1));
                
                if (bonusPts > 0) {
                    timeline.push({
                        id: `rt-earn-${b.id}`,
                        date: b.timeStart || todayStr,
                        points: bonusPts,
                        type: 'EARN',
                        desc: `Thưởng đánh giá (${bookingRating}★) - Đơn ${b.billCode || b.id.substring(0, 6)} | Thời lượng KTV làm: ${totalDuration}p | Chia điểm: /${allKtvCodes.size}`
                    });
                }
            }
        }
    });

    (earns || []).forEach(e => {
        timeline.push({
            id: `earn-${e.date}`,
            date: e.date,
            points: Number(e.total_bonus),
            type: 'EARN',
            desc: 'Điểm làm dịch vụ (Chốt sổ ngày)'
        });
    });

    (adjs || []).forEach(a => {
        const amt = Number(a.amount);
        const isGift = a.type === 'GIFT' || amt > 0;
        timeline.push({
            id: `adj-${a.created_at}`,
            date: a.created_at,
            points: Math.abs(amt),
            type: isGift ? 'GIFT' : 'PENALTY',
            desc: a.reason || (isGift ? 'Thưởng điểm' : 'Phạt điểm')
        });
    });

    (wths || []).forEach(w => {
        timeline.push({
            id: `wth-${w.request_date}`,
            date: w.request_date,
            points: Number(w.amount),
            type: 'REDEEM',
            desc: `Quy đổi điểm (${w.status})`,
            status: w.status
        });
    });

    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log(`Bảng phân bổ điểm (Ca hiện tại: ${currentShift}):`);
    console.log(`- Base Points (Đủ 60p): ${basePointsForShift} pts`);
    console.log(`- Base Points (< 60p): ${basePointsForShift / 2} pts\n`);

    console.table(timeline.map(t => ({
        "Thời gian": t.date.replace('T', ' ').substring(0, 16),
        "Loại": t.type,
        "Điểm": (t.type === 'REDEEM' || t.type === 'PENALTY' ? '-' : '+') + t.points,
        "Mô tả": t.desc.substring(0, 50)
    })));

    let totalPoints = 0;
    timeline.forEach(t => {
        if (t.type === 'REDEEM' || t.type === 'PENALTY') {
            totalPoints -= t.points;
        } else {
            totalPoints += t.points;
        }
    });

    console.log(`\n=> SỐ DƯ VÍ BONUS HIỆN TẠI (ƯỚC TÍNH): ${totalPoints} điểm`);
    console.log(`======================================================\n`);
}

simulateBonusTimeline('NH001').catch(console.error);
