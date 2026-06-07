import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const techCode = searchParams.get('techCode');

    if (!techCode) {
        return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
    }

    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'Lỗi máy chủ' }, { status: 500 });

        const START_DATE = '2026-06-01';

        // 1. Fetch Earned
        const { data: earns, error: earnErr } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_bonus, staff_id')
            .eq('staff_id', techCode)
            .gte('date', START_DATE)
            .gt('total_bonus', 0)
            .order('date', { ascending: false });

        if (earnErr) throw earnErr;

        // 2. Fetch Adjustments (GIFT/PENALTY)
        const { data: adjs, error: adjErr } = await supabase
            .from('WalletAdjustments')
            .select('created_at, amount, type, reason')
            .eq('staff_id', techCode)
            .eq('wallet_type', 'BONUS')
            .gte('created_at', `${START_DATE}T00:00:00+07:00`);

        if (adjErr) throw adjErr;

        // 3. Fetch Withdrawals (REDEEM)
        const { data: wths, error: wthErr } = await supabase
            .from('KTVWithdrawals')
            .select('request_date, amount, status')
            .eq('staff_id', techCode)
            .eq('wallet_type', 'BONUS')
            .gte('request_date', `${START_DATE}T00:00:00+07:00`);

        const nowVn = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const todayStr = nowVn.toISOString().split('T')[0];
        const fromDate = `${todayStr}T00:00:00+07:00`;

        // 4. Determine Shift and Configs for Realtime Bonus
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus', 'holiday_shift2_dates']);

        const configMap: Record<string, any> = {};
        (configs || []).forEach((c: any) => { configMap[c.key] = c.value; });
        
        const s1Bonus = Number(configMap['ktv_shift_1_bonus'] || 20);
        const s2Bonus = Number(configMap['ktv_shift_2_bonus'] || 20);
        const s3Bonus = Number(configMap['ktv_shift_3_bonus'] || 40);

        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('effectiveFrom, shiftType')
            .eq('employeeId', techCode)
            .lte('effectiveFrom', todayStr)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });

        let currentShift = 'SHIFT_1';
        for (const s of (shiftsData || [])) {
            const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
            if (effDate && effDate <= todayStr) currentShift = s.shiftType;
        }

        const targetMonthDay = todayStr.slice(5, 10);
        let isHoliday = false;
        const holidayDates = configMap['holiday_shift2_dates'] || ['04-30', '09-02', '12-31'];
        if (Array.isArray(holidayDates) && holidayDates.includes(targetMonthDay)) isHoliday = true;

        const shiftType = isHoliday ? 'SHIFT_2' : currentShift;
        let basePointsForShift = s1Bonus;
        if (shiftType === 'SHIFT_2') basePointsForShift = s2Bonus;
        else if (shiftType === 'SHIFT_3') basePointsForShift = s3Bonus;

        // 5. Fetch Realtime Bookings for today
        const { data: bookings } = await supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating, billCode,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, itemRating )
            `)
            .gte('timeStart', `${todayStr}T00:00:00+07:00`)
            .in('status', ['DONE', 'FEEDBACK', 'CLEANING']);

        // 4. Merge and Format
        const timeline: any[] = [];

        (bookings || []).forEach(b => {
            let isInvovled = false;
            const allKtvCodes = new Set<string>();
            for (const item of (b.BookingItems || [])) {
                if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                    item.technicianCodes.forEach((tc: string) => {
                        allKtvCodes.add(tc.toLowerCase());
                        if (tc.toLowerCase() === techCode.toLowerCase()) isInvovled = true;
                    });
                }
            }
            
            if (isInvovled) {
                // Tính rating lớn nhất của KTV này từ các dịch vụ họ trực tiếp làm trong đơn
                let maxKtvRating = 0;
                for (const item of (b.BookingItems || [])) {
                    const isTechInvolved = item.technicianCodes && Array.isArray(item.technicianCodes) &&
                        item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase());
                    
                    if (isTechInvolved) {
                        let ktvRating = 0;
                        let parsedKtvRatings = (item as any).ktvRatings;
                        if (typeof parsedKtvRatings === 'string') {
                            try { parsedKtvRatings = JSON.parse(parsedKtvRatings); } catch { parsedKtvRatings = {}; }
                        }
                        if (parsedKtvRatings && typeof parsedKtvRatings === 'object') {
                            const key = Object.keys(parsedKtvRatings).find(k => k.toLowerCase() === techCode.toLowerCase());
                            if (key) {
                                ktvRating = Number(parsedKtvRatings[key]) || 0;
                            }
                        }
                        if (ktvRating === 0) {
                            ktvRating = Number(item.itemRating) || 0;
                        }
                        if (ktvRating === 0) {
                            ktvRating = Number(b.rating) || 0;
                        }
                        if (ktvRating > maxKtvRating) {
                            maxKtvRating = ktvRating;
                        }
                    }
                }

                if (maxKtvRating >= 4) {
                    let totalDuration = 0;
                    for (const item of (b.BookingItems || [])) {
                        let segs: any[] = [];
                        try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
                        
                        const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));
                        if (mySegs.length > 0) {
                            totalDuration += mySegs.reduce((sum: number, seg: any) => {
                                return sum + (Number(seg.duration) || 0);
                            }, 0);
                        } else if (item.technicianCodes && item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase())) {
                            totalDuration += 60;
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
                            desc: `Thưởng đánh giá (${maxKtvRating}★) - Đơn ${b.billCode || b.id.substring(0, 6)}`
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
                desc: 'Điểm làm dịch vụ'
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
                points: Number(w.amount) / 1000,
                type: 'REDEEM',
                desc: `Quy đổi điểm (${w.status})`,
                status: w.status
            });
        });

        // Sort by Date Descending
        timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return NextResponse.json({
            success: true,
            data: timeline
        });
    } catch (error: any) {
        console.error('Lỗi lấy lịch sử bonus:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
