import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvTypeDBonusService } from '@/lib/services/KtvTypeDBonusService';
import { KtvWalletService } from '@/lib/services/KtvWalletService';

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
        let workType = await KtvWalletService.getWorkTypeSnapshot(supabase as any, techCode);

        // 1. Fetch Earned
        const { data: earns, error: earnErr } = await KtvWalletService.applySnapshotFilter(
        supabase.from('KTVDailyLedger').select('date, total_bonus, staff_id').eq('staff_id', techCode),
        workType
    )
            .gte('date', START_DATE)
            .gt('total_bonus', 0)
            .order('date', { ascending: false });

        if (earnErr) throw earnErr;

        // 2. Fetch Adjustments (GIFT/PENALTY)
        const { data: adjs, error: adjErr } = await KtvWalletService.applySnapshotFilter(
        supabase.from('WalletAdjustments').select('created_at, amount, type, reason').eq('staff_id', techCode).eq('wallet_type', 'BONUS'),
        workType
    )
            .gte('created_at', `${START_DATE}T00:00:00+07:00`);

        if (adjErr) throw adjErr;

        // 3. Fetch Withdrawals (REDEEM)
        const { data: wths, error: wthErr } = await KtvWalletService.applySnapshotFilter(
        supabase.from('KTVWithdrawals').select('request_date, amount, status').eq('staff_id', techCode).eq('wallet_type', 'BONUS'),
        workType
    )
            .gte('request_date', `${START_DATE}T00:00:00+07:00`);

        const nowVn = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const todayStr = nowVn.toISOString().split('T')[0];
        const fromDate = `${todayStr}T00:00:00+07:00`;

        // 4. Determine Shift
        const { data: allStaffData } = await supabase
            .from('Staff')
            .select('id, work_type, feature_flags');
            
        // let workType removed
        const staffWorkTypeMap: Record<string, string> = {};
        const staffBonusMap: Record<string, boolean> = {};
        (allStaffData || []).forEach(s => {
            staffWorkTypeMap[s.id.toLowerCase()] = s.work_type || 'TYPE_A';
            const canBonus = s.feature_flags?.enable_bonus ?? true;
            staffBonusMap[s.id.toLowerCase()] = canBonus;
            if (s.id === techCode) {
                workType = s.work_type || 'TYPE_A';
            }
        });

        // 3. Fetch System Configs
        const bonusConfigData = await KtvCommissionService.getBonusConfig(supabase as any, workType as any);
        const s1Bonus = bonusConfigData.s1Bonus;
        const s2Bonus = bonusConfigData.s2Bonus;
        const s3Bonus = bonusConfigData.s3Bonus;
        const enableBonus = bonusConfigData.enableBonus;

        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['holiday_shift2_dates']);

        const configMap: Record<string, any> = {};
        (configs || []).forEach((c: any) => { configMap[c.key] = c.value; });

        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('employeeId, effectiveFrom, shiftType')
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

        const bonusConfig = { s1Bonus, s2Bonus, s3Bonus, enableBonus };

        const { data: services } = await supabase.from('Services').select('id, is_utility');
        const svcUtilityMap: Record<string, boolean> = {};
        (services || []).forEach(s => { svcUtilityMap[String(s.id)] = s.is_utility === true; });

        // 5. Fetch Realtime Bookings for today
        const { data: bookings } = await supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating, billCode, guestCount, createdAt,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options, handover_status, handover_comment )
            `)
            .gte('bookingDate', todayStr)
            .not('status', 'in', '("CANCELLED","NEW")');

        // 6. Calculate bonuses from valid bookings
        const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

        // 4. Merge and Format
        const timeline: any[] = [];

        for (const b of validBookings) {
            const DONE_STATUSES = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
            const relevantItems = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes &&
                Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase())) &&
                DONE_STATUSES.includes(i.status)
            );

            if (relevantItems.length === 0) continue;
            
            const bDate = new Date(b.timeStart || (b as any).createdAt || todayStr);
            const isNewRule = bDate >= new Date('2026-08-05T00:00:00+07:00');
            let bForBonus = b;
            if (!isNewRule) {
                const filteredItemsForBonus = (b.BookingItems || []).filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
                bForBonus = { ...b, BookingItems: filteredItemsForBonus };
            }
            
            const bonusPts = KtvCommissionService.calculateBookingBonus(bForBonus, techCode, todayStr, shiftsData || [], bonusConfig, staffWorkTypeMap, staffBonusMap, isNewRule);
            if (bonusPts > 0) {
                // Determine maxKtvRating to show in desc
                let maxKtvRating = 0;
                for (const item of (b.BookingItems || [])) {
                    let isTechInvolved = false;
                    if (item.technicianCodes && Array.isArray(item.technicianCodes) && item.technicianCodes.length > 0) {
                        isTechInvolved = item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase());
                    } else {
                        const codes = typeof b.technicianCode === 'string' ? b.technicianCode.split(',') : [];
                        isTechInvolved = codes.some((tc: string) => tc.trim().toLowerCase() === techCode.toLowerCase());
                    }
                    if (!isTechInvolved) continue;

                    let ktvRating = 0;
                    let parsedKtvRatings = item.ktvRatings;
                    if (typeof parsedKtvRatings === 'string') {
                        try { parsedKtvRatings = JSON.parse(parsedKtvRatings); } catch { parsedKtvRatings = {}; }
                    }
                    if (parsedKtvRatings && typeof parsedKtvRatings === 'object') {
                        const key = Object.keys(parsedKtvRatings).find((k: string) => k.toLowerCase() === techCode.toLowerCase());
                        if (key) ktvRating = Number(parsedKtvRatings[key]) || 0;
                    }
                    if (ktvRating === 0) ktvRating = Number(item.itemRating) || 0;
                    if (ktvRating === 0) ktvRating = Number(b.rating) || 0;
                    if (ktvRating > maxKtvRating) maxKtvRating = ktvRating;
                }

                timeline.push({
                    id: `rt-earn-${b.id}`,
                    date: b.timeStart || todayStr,
                    points: bonusPts,
                    type: 'EARN',
                    desc: `Thưởng đánh giá (${maxKtvRating}★) - Đơn ${b.billCode || b.id.substring(0, 6)}`
                });
            }
        }

        (earns || []).forEach((e: any) => {
            timeline.push({
                id: `earn-${e.date}`,
                date: `${e.date}T23:59:59+07:00`,
                points: Number(e.total_bonus),
                type: 'EARN',
                desc: 'Điểm làm dịch vụ'
            });
        });

        (adjs || []).forEach((a: any) => {
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

        (wths || []).forEach((w: any) => {
            timeline.push({
                id: `wth-${w.request_date}`,
                date: w.request_date,
                points: Number(w.amount) / 1000,
                type: 'REDEEM',
                desc: `Quy đổi điểm (${w.status})`,
                status: w.status
            });
        });

        // Sort timeline asc by date to calculate running balance
        timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let currentBalance = 0;
        timeline.forEach(item => {
            if (item.status !== 'REJECTED') {
                if (item.type === 'EARN' || item.type === 'GIFT') {
                    currentBalance += Number(item.points);
                } else if (item.type === 'PENALTY' || item.type === 'REDEEM') {
                    currentBalance -= Number(item.points);
                }
            }
            item.running_balance = currentBalance;
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
