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

// Internal core logic for syncing ledger
async function processLedgerSync(targetDateStr: string) {
    console.log(`[Cron] Syncing Daily Ledger for date: ${targetDateStr}`);

    // Boundaries in VN time
    const startTimeStr = `${targetDateStr}T00:00:00+07:00`;
    const endTimeStr = `${targetDateStr}T23:59:59.999+07:00`;

    // 1. Get configs
    const { data: configs } = await supabase
        .from('SystemConfigs')
        .select('key, value')
        .in('key', ['ktv_commission_milestones', 'ktv_commission_per_60min', 'ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus', 'ktv_sudden_off_penalty', 'enable_bonus_wallet']);
        
    const configMap: Record<string, any> = {};
    (configs || []).forEach((c: any) => { configMap[c.key] = c.value; });

    let milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
    let ratePer60 = 100000;
    
    if (configMap['ktv_commission_milestones']) { try { milestones = typeof configMap['ktv_commission_milestones'] === 'string' ? JSON.parse(configMap['ktv_commission_milestones']) : configMap['ktv_commission_milestones']; } catch { } }
    if (configMap['ktv_commission_per_60min']) {
        const rawRate = String(configMap['ktv_commission_per_60min']).replace(/[^0-9]/g, '');
        if (rawRate) ratePer60 = Number(rawRate);
    }
    
    const s1Bonus = Number(configMap['ktv_shift_1_bonus'] || 20);
    const s2Bonus = Number(configMap['ktv_shift_2_bonus'] || 20);
    const s3Bonus = Number(configMap['ktv_shift_3_bonus'] || 40);
    const suddenOffPenalty = Number(configMap['ktv_sudden_off_penalty'] || 50000);
    const isBonusWalletEnabled = String(configMap['enable_bonus_wallet'] || '').replace(/"/g, '') === 'true';

    // 2. Fetch KTVs
    const { data: ktvs } = await supabase
        .from('Staff')
        .select('id, full_name')
        .eq('status', 'ĐANG LÀM')
        .ilike('id', 'NH%');
    
    if (!ktvs || ktvs.length === 0) return NextResponse.json({ success: true, message: 'No KTVs found' });

    // 2.5 Fetch Shifts
    const { data: shiftsData } = await supabase
        .from('KTVShifts')
        .select('employeeId, shiftType, effectiveFrom')
        .lte('effectiveFrom', targetDateStr)
        .in('status', ['ACTIVE', 'REPLACED'])
        .order('effectiveFrom', { ascending: true })
        .order('createdAt', { ascending: true });
        
    const ktvShiftMap = new Map<string, string>();
    (shiftsData || []).forEach(s => ktvShiftMap.set(s.employeeId, s.shiftType));

    // Lấy config ngày lễ để đè ca 2
    let isHoliday = false;
    const holidayDates = configMap['holiday_shift2_dates'];
    if (holidayDates && Array.isArray(holidayDates)) {
        const targetMonthDay = targetDateStr.slice(5, 10);
        if (holidayDates.includes(targetMonthDay)) {
            isHoliday = true;
        }
    }
    
    if (isHoliday) {
        ktvs.forEach(ktv => ktvShiftMap.set(ktv.id, 'SHIFT_2'));
    }

    // 3. Fetch Bookings for the target date
    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, timeStart, timeEnd, status, technicianCode, rating,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating )
        `)
        .gte('timeStart', startTimeStr)
        .lte('timeStart', endTimeStr)
        .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);

    const { data: services } = await supabase.from('Services').select('id, duration');
    const svcDurationMap: Record<string, number> = {};
    (services || []).forEach(s => { svcDurationMap[String(s.id)] = s.duration || 60; });

    // 4. Fetch Adjustments & Withdrawals for the target date
    const { data: adjustments } = await supabase
        .from('WalletAdjustments')
        .select('staff_id, amount')
        .gte('created_at', startTimeStr)
        .lte('created_at', endTimeStr);

    const { data: withdrawals } = await supabase
        .from('KTVWithdrawals')
        .select('staff_id, amount')
        .eq('status', 'APPROVED')
        .gte('request_date', startTimeStr)
        .lte('request_date', endTimeStr);

    // 4.5 Fetch Sudden Offs
    const { data: suddenOffs } = await supabase
        .from('KTVLeaveRequests')
        .select('employeeId')
        .eq('date', targetDateStr)
        .eq('is_sudden_off', true);

    const suddenOffCountMap: Record<string, number> = {};
    (suddenOffs || []).forEach(l => {
        suddenOffCountMap[l.employeeId] = (suddenOffCountMap[l.employeeId] || 0) + 1;
    });

    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

    const upsertRows = [];
    const bonusRecords: any[] = [];

    // 5. Calculate per KTV
    for (const ktv of ktvs) {
        const techCode = ktv.id;
        let total_commission = 0;
        let total_tip = 0;
        let total_bonus = 0;
        let total_penalty = (suddenOffCountMap[techCode] || 0) * suddenOffPenalty;
        
        const shiftType = ktvShiftMap.get(techCode) || 'SHIFT_1';
        let basePoints = s1Bonus;
        if (shiftType === 'SHIFT_2') basePoints = s2Bonus;
        else if (shiftType === 'SHIFT_3') basePoints = s3Bonus;

        for (const b of validBookings) {
            const relevantItems = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes && Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
            );

            if (relevantItems.length === 0) continue;

            let totalDuration = 0;

            for (const item of relevantItems) {
                // Tính duration
                let segs: any[] = [];
                try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }

                const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));

                if (mySegs.length > 0) {
                    totalDuration += mySegs.reduce((sum: number, seg: any) => {
                        const realMins = getMinsFromTimes(seg.startTime, seg.endTime);
                        if (realMins > 0) return sum + realMins;
                        return sum + (Number(seg.duration) || 0);
                    }, 0);
                } else {
                    totalDuration += svcDurationMap[String(item.serviceId)] || 60;
                }
            }

            total_commission += calcCommission(totalDuration || 60, milestones, ratePer60);
            total_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
            
            // Bonus: per booking, chia đều unique KTVs, Math.floor
            const bRating = Number(b.rating) || 0;
            const maxItemRating = Math.max(...(b.BookingItems || []).map((i: any) => Number(i.itemRating) || 0), 0);
            const bookingRating = Math.max(bRating, maxItemRating);

            if (bookingRating >= 4) {
                let adjustedBasePoints = basePoints;
                if (totalDuration < 60) {
                    adjustedBasePoints = basePoints / 2;
                }

                const allKtvCodes = new Set<string>();
                for (const item of (b.BookingItems || [])) {
                    if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                        item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
                    }
                }
                const totalUniqueKTVs = allKtvCodes.size || 1;
                const bonusPts = Math.floor(adjustedBasePoints / totalUniqueKTVs);
                total_bonus += bonusPts;

                // Record for KTVBonusLedger (only when feature is ON)
                if (isBonusWalletEnabled && bonusPts > 0) {
                    bonusRecords.push({
                        staff_id: techCode,
                        booking_id: b.id,
                        points: bonusPts,
                        type: 'EARN',
                        description: `Bonus ${bonusPts}đ (${adjustedBasePoints}/${totalUniqueKTVs} KTV) - Rating ${bookingRating}★`,
                        date: targetDateStr
                    });
                }
            }
        }

        const ktvAdjustments = (adjustments || []).filter(a => a.staff_id === techCode);
        const ktvWithdrawals = (withdrawals || []).filter(w => w.staff_id === techCode);

        const total_adjustment = ktvAdjustments.reduce((sum, a) => sum + Number(a.amount), 0);
        const total_withdrawn = ktvWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0);

        upsertRows.push({
            date: targetDateStr,
            staff_id: techCode,
            total_commission,
            total_tip,
            total_bonus,
            total_penalty,
            total_adjustment,
            total_withdrawn,
            updated_at: new Date().toISOString()
        });
    }

    // 6. Bulk UPSERT KTVDailyLedger
    if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabase
            .from('KTVDailyLedger')
            .upsert(upsertRows, {
                onConflict: 'date, staff_id'
            });

        if (upsertErr) {
            console.error('Upsert Error:', upsertErr);
            throw upsertErr;
        }
    }

    // 7. Bulk UPSERT KTVBonusLedger (only when feature is ON)
    if (isBonusWalletEnabled && bonusRecords.length > 0) {
        const { error: bonusErr } = await supabase
            .from('KTVBonusLedger')
            .upsert(bonusRecords, {
                onConflict: 'staff_id, booking_id',
                ignoreDuplicates: true
            });

        if (bonusErr) {
            console.error('Bonus Ledger Upsert Error:', bonusErr);
            // Non-blocking: log but don't throw
        } else {
            console.log(`[Cron] Inserted ${bonusRecords.length} bonus records into KTVBonusLedger`);
        }
    }

    return NextResponse.json({ success: true, message: `Synced ${upsertRows.length} ledgers for ${targetDateStr}` });
}

// API: GET /api/cron/sync-daily-ledger (Used by Vercel Cron)
export async function GET(request: Request) {
    // Security verification for Vercel Cron
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVn = new Date(Date.now() + VN_OFFSET_MS);
        nowVn.setDate(nowVn.getDate() - 1); // Yesterday
        const targetDateStr = nowVn.toISOString().split('T')[0];

        return await processLedgerSync(targetDateStr);
    } catch (err: any) {
        console.error('Exception in GET sync-daily-ledger:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

// API: POST /api/cron/sync-daily-ledger (Used for manual triggers via Admin/Script)
// Body: { targetDate: 'YYYY-MM-DD' } (Optional, defaults to yesterday)
export async function POST(request: Request) {
    try {
        let targetDateStr = '';
        try {
            const body = await request.json();
            targetDateStr = body.targetDate;
        } catch { }

        if (!targetDateStr) {
            const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
            const nowVn = new Date(Date.now() + VN_OFFSET_MS);
            nowVn.setDate(nowVn.getDate() - 1); // Yesterday
            targetDateStr = nowVn.toISOString().split('T')[0];
        }

        return await processLedgerSync(targetDateStr);
    } catch (err: any) {
        console.error('Exception in POST sync-daily-ledger:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
