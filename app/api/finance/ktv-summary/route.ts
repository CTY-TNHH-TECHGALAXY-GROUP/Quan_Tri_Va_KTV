import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const calcCommission = (durationMins: number, milestones: any, ratePer60: number) => {
    const sMins = String(durationMins);
    if (milestones && milestones[sMins] !== undefined) {
        return Number(milestones[sMins]);
    }
    const h = durationMins / 60;
    const comm = Math.round(h * ratePer60);
    return Math.round(comm / 1000) * 1000;
};

const getMinsFromTimes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
    let mins1 = h1 * 60 + m1;
    let mins2 = h2 * 60 + m2;
    if (mins2 < mins1) mins2 += 24 * 60;
    return mins2 - mins1;
};

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const fromDate = searchParams.get('fromDate');
        const toDate = searchParams.get('toDate');

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';

        // 1. Get configs
        const [{ data: milestoneConf }, { data: rateConf }, { data: depositConf }, { data: penaltyConf }, { data: bonusConfigs }] = await Promise.all([
            supabase.from('SystemConfigs').select('value').eq('key', 'ktv_commission_milestones').single(),
            supabase.from('SystemConfigs').select('value').eq('key', 'ktv_commission_per_60min').single(),
            supabase.from('SystemConfigs').select('value').eq('key', 'ktv_min_deposit').single(),
            supabase.from('SystemConfigs').select('value').eq('key', 'enable_penalty_deduction').single(),
            supabase.from('SystemConfigs').select('key, value').in('key', ['ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus'])
        ]);
        
        let milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
        let ratePer60 = 100000;
        let global_min_deposit = 500000;
        
        if (milestoneConf?.value) { try { milestones = typeof milestoneConf.value === 'string' ? JSON.parse(milestoneConf.value) : milestoneConf.value; } catch { } }
        if (rateConf?.value) {
            const rawRate = String(rateConf.value).replace(/[^0-9]/g, '');
            if (rawRate) ratePer60 = Number(rawRate);
        }
        if (depositConf?.value) {
            const rawDeposit = String(depositConf.value).replace(/[^0-9]/g, '');
            if (rawDeposit) global_min_deposit = Number(rawDeposit);
        }
        
        const isPenaltyEnabled = penaltyConf?.value === 'true';

        // Bonus config per shift
        const bonusMap: Record<string, number> = {};
        (bonusConfigs || []).forEach((c: any) => { bonusMap[c.key] = Number(c.value) || 20; });
        const s1Bonus = bonusMap['ktv_shift_1_bonus'] || 20;
        const s2Bonus = bonusMap['ktv_shift_2_bonus'] || 20;
        const s3Bonus = bonusMap['ktv_shift_3_bonus'] || 40;

        // 2. Fetch KTVs
        const { data: ktvs } = await supabase
            .from('Staff')
            .select('id, full_name, position')
            .eq('status', 'ĐANG LÀM')
            .ilike('id', 'NH%')
            .order('id');
            
        if (!ktvs || ktvs.length === 0) return NextResponse.json({ success: true, data: [] });

        // Fetch KTV shifts to determine bonus per KTV
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('employeeId, shiftType, effectiveFrom')
            .in('employeeId', ktvs.map(k => k.id))
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });

        // --- CƠ CHẾ DYNAMIC BRIDGE (Đã fix lỗi trùng lặp dữ liệu) ---
        // Lấy ngày hiện tại ở Việt Nam (YYYY-MM-DD) — dùng cách tính giống cron job
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // 3. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay để tránh đụng độ Realtime)
        let ledgerQuery = supabase
            .from('KTVDailyLedger')
            .select('date, staff_id, total_commission, total_tip, total_bonus, total_penalty, total_adjustment, total_withdrawn');
            
        if (fromDate) ledgerQuery = ledgerQuery.gte('date', fromDate);
        else ledgerQuery = ledgerQuery.gte('date', GLOBAL_START_DATE_STR);
        
        if (toDate) ledgerQuery = ledgerQuery.lte('date', toDate);

        const { data: ledgers } = await ledgerQuery;

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;
        const ledgerMap: Record<string, any> = {};
        ktvs.forEach(k => {
            ledgerMap[k.id] = { comm: 0, tip: 0, bonus: 0, penalty: 0, adj: 0, withdrawn: 0 };
        });

        if (ledgers && ledgers.length > 0) {
            // LOẠI BỎ Sổ cái của ngày hôm nay (nếu có)
            const pastLedgers = ledgers.filter(l => l.date < todayStr);
            
            if (pastLedgers.length > 0) {
                let maxDateStr = pastLedgers[0].date;
                pastLedgers.forEach(l => {
                    if (l.date > maxDateStr) maxDateStr = l.date;
                    if (ledgerMap[l.staff_id]) {
                        ledgerMap[l.staff_id].comm += Number(l.total_commission || 0);
                        ledgerMap[l.staff_id].tip += Number(l.total_tip || 0);
                        ledgerMap[l.staff_id].bonus += Number(l.total_bonus || 0);
                        ledgerMap[l.staff_id].penalty += Number(l.total_penalty || 0);
                    }
                });

                // Tính toán chính xác ngày tiếp theo mà không bị lệch múi giờ
                const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
                const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
                const nextDateStr = nextDateVn.toISOString().split('T')[0];
                
                realtimeStartStr = `${nextDateStr}T00:00:00+07:00`;
            }
        }

        // Cập nhật realtimeStartStr nếu có fromDate
        if (fromDate && realtimeStartStr < `${fromDate}T00:00:00+07:00`) {
            realtimeStartStr = `${fromDate}T00:00:00+07:00`;
        }

        // 4. Fetch Realtime Bookings from realtimeStartStr
        let bookingQuery = supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings )
            `)
            .gte('timeStart', realtimeStartStr)
            .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);
            
        if (toDate) bookingQuery = bookingQuery.lte('timeStart', `${toDate}T23:59:59+07:00`);

        const { data: bookings } = await bookingQuery;

        const { data: services } = await supabase.from('Services').select('id, duration');
        const svcDurationMap: Record<string, number> = {};
        (services || []).forEach(s => { svcDurationMap[String(s.id)] = s.duration || 60; });

        const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

        // 5. Fetch Realtime Adjustments and Withdrawals
        let adjQuery = supabase.from('WalletAdjustments').select('staff_id, amount');
        if (fromDate) adjQuery = adjQuery.gte('created_at', `${fromDate}T00:00:00+07:00`);
        else adjQuery = adjQuery.gte('created_at', GLOBAL_START_DATE_ISO);
        if (toDate) adjQuery = adjQuery.lte('created_at', `${toDate}T23:59:59+07:00`);
        const { data: realtimeAdjustments } = await adjQuery;

        // Withdrawals: LUÔN query FULL range vì ảnh hưởng đến số dư hiện tại (không filter theo fromDate/toDate)
        const { data: realtimeWithdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount, status')
            .gte('request_date', GLOBAL_START_DATE_ISO);

        const { data: pendingWithdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount, note')
            .eq('status', 'PENDING')
            .gte('request_date', GLOBAL_START_DATE_ISO);

        // 5. Calculate per KTV
        const summaries = ktvs.map(ktv => {
            const techCode = ktv.id;
            let rt_commission = 0;
            let rt_tip = 0;
            let rt_bonus = 0;

            for (const b of validBookings) {
                const relevantItems = (b.BookingItems || []).filter((i: any) =>
                    i.technicianCodes && Array.isArray(i.technicianCodes) &&
                    i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
                );

                if (relevantItems.length === 0) continue;

                let totalDuration = 0;
                let bookingCommission = 0;
                for (const item of relevantItems) {
                    let itemDuration = 0;
                    let segs: any[] = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }

                    const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));

                    if (mySegs.length > 0) {
                        itemDuration = mySegs.reduce((sum: number, seg: any) => {
                            const realMins = getMinsFromTimes(seg.startTime, seg.endTime);
                            if (realMins > 0) return sum + realMins;
                            return sum + (Number(seg.duration) || 0);
                        }, 0);
                    } else {
                        itemDuration = svcDurationMap[String(item.serviceId)] || 60;
                    }
                    if (itemDuration <= 0) itemDuration = 60;
                    totalDuration += itemDuration;
                    // Tính commission CHO TỪNG DỊCH VỤ rồi cộng dồn
                    bookingCommission += calcCommission(itemDuration, milestones, ratePer60);
                }

                rt_commission += bookingCommission || calcCommission(60, milestones, ratePer60);
                rt_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);

                // === Calculate Bonus (ĐỒNG BỘ LOGIC VỚI API VÍ KTV bonus/balance) ===
                let maxKtvRating = 0;
                for (const item of relevantItems) {
                    let ktvRating = 0;
                    // Fallback chain: ktvRatings → itemRating → booking.rating
                    let parsedKtvRatings = (item as any).ktvRatings;
                    if (typeof parsedKtvRatings === 'string') {
                        try { parsedKtvRatings = JSON.parse(parsedKtvRatings); } catch { parsedKtvRatings = {}; }
                    }
                    if (parsedKtvRatings && typeof parsedKtvRatings === 'object') {
                        const key = Object.keys(parsedKtvRatings).find(k => k.toLowerCase() === techCode.toLowerCase());
                        if (key) ktvRating = Number(parsedKtvRatings[key]) || 0;
                    }
                    if (ktvRating === 0) ktvRating = Number(item.itemRating) || 0;
                    if (ktvRating === 0) ktvRating = Number(b.rating) || 0;
                    if (ktvRating > maxKtvRating) maxKtvRating = ktvRating;
                }

                if (maxKtvRating >= 4) {
                    // Tính duration RIÊNG cho KTV này (chỉ segment của họ)
                    let myTotalDuration = 0;
                    for (const item of (b.BookingItems || [])) {
                        let segs: any[] = [];
                        try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
                        const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));
                        if (mySegs.length > 0) {
                            myTotalDuration += mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
                        } else if (item.technicianCodes && item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase())) {
                            myTotalDuration += 60; // Fallback
                        }
                    }

                    // Use basePoints from KTV's shift config
                    const bookingDateStr = b.timeStart ? b.timeStart.slice(0, 10) : todayStr;
                    let currentShift = 'SHIFT_1';
                    const ktvShifts = (shiftsData || []).filter(s => s.employeeId === techCode);
                    for (const s of ktvShifts) {
                        const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                        if (effDate && effDate <= bookingDateStr) currentShift = s.shiftType;
                    }

                    let adjustedBasePoints = s1Bonus;
                    if (currentShift === 'SHIFT_2') adjustedBasePoints = s2Bonus;
                    else if (currentShift === 'SHIFT_3') adjustedBasePoints = s3Bonus;

                    if (myTotalDuration < 60) adjustedBasePoints = adjustedBasePoints / 2;

                    const allKtvCodes = new Set<string>();
                    for (const item of (b.BookingItems || [])) {
                        if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                            item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
                        }
                    }
                    const totalUniqueKTVs = allKtvCodes.size || 1;
                    const bonusPts = Math.floor(adjustedBasePoints / totalUniqueKTVs);
                    rt_bonus += bonusPts;
                }
            }

            const rt_adjustment = (realtimeAdjustments || []).filter(a => a.staff_id === techCode).reduce((sum, a) => sum + Number(a.amount), 0);
            const rt_withdrawn = (realtimeWithdrawals || []).filter(w => w.staff_id === techCode && w.status === 'APPROVED').reduce((sum, w) => sum + Number(w.amount), 0);
            const total_pending = (pendingWithdrawals || [])
                .filter(w => w.staff_id === techCode && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
                .reduce((sum, w) => sum + Number(w.amount), 0);

            const ledger = ledgerMap[techCode];
            const total_commission = ledger.comm + rt_commission;
            const total_tip = ledger.tip + rt_tip;
            const total_bonus = ledger.bonus + rt_bonus; // Đã bao gồm thưởng rating của hôm nay
            const total_penalty = isPenaltyEnabled ? ledger.penalty : 0; // ⚠️ Feature flag bật/tắt phạt đột xuất

            // ✅ Bonus KHÔNG cộng vào gross_income — tách sang ví điểm bonus riêng
            const gross_income = total_commission + rt_adjustment - total_penalty;
            const min_deposit = global_min_deposit;
            const net_balance = gross_income - rt_withdrawn - total_pending;
            const available_balance = Math.max(0, net_balance - min_deposit);
            const effective_balance = Math.max(0, net_balance);

            return {
                id: ktv.id,
                name: ktv.full_name,
                position: ktv.position,
                total_commission,
                total_tip,
                total_bonus,
                total_penalty,
                total_adjustment: rt_adjustment,
                total_withdrawn: rt_withdrawn,
                total_pending,
                gross_income,
                min_deposit,
                net_balance,
                available_balance,
                effective_balance
            };
        });

        return NextResponse.json({ success: true, data: summaries });
    } catch (err: any) {
        console.error('Exception in /api/finance/ktv-summary:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
