import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvWalletService } from '@/lib/services/KtvWalletService';
import { KtvTypeDBonusService } from '@/lib/services/KtvTypeDBonusService';

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

        const { data: allStaffData } = await supabase
            .from('Staff')
            .select('id, work_type, feature_flags');
            
        let workType = 'TYPE_A';
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

        // 4. Fetch Bonus Configs via KtvCommissionService
        const bonusConfigData = await KtvCommissionService.getBonusConfig(supabase as any, workType as any);
        // Map to expected structure in legacy code or use it directly
        const s1Bonus = bonusConfigData.s1Bonus;
        const s2Bonus = bonusConfigData.s2Bonus;
        const s3Bonus = bonusConfigData.s3Bonus;
        const enableBonus = bonusConfigData.enableBonus;

        // 1. Fetch Earned Bonus
        const { data: earns, error: earnErr } = await KtvWalletService.applySnapshotFilter(
            supabase.from('KTVDailyLedger').select('total_bonus').eq('staff_id', techCode),
            workType
        )
            .gte('date', START_DATE)
            .gt('total_bonus', 0);

        if (earnErr) throw earnErr;

        // 2. Fetch Deducted Bonus
        const { data: adjustments, error: adjErr } = await KtvWalletService.applySnapshotFilter(
            supabase.from('WalletAdjustments').select('amount, type').eq('staff_id', techCode),
            workType
        )
            .eq('wallet_type', 'BONUS')
            .gte('created_at', `${START_DATE}T00:00:00+07:00`);

        if (adjErr) throw adjErr;

        // 3. Fetch Redeemed Bonus
        const { data: withdrawals, error: wthErr } = await KtvWalletService.applySnapshotFilter(
            supabase.from('KTVWithdrawals').select('amount').eq('staff_id', techCode),
            workType
        )
            .eq('wallet_type', 'BONUS')
            .gte('request_date', `${START_DATE}T00:00:00+07:00`)
            .in('status', ['PENDING', 'APPROVED']);

        if (wthErr) throw wthErr;

        // 3.5 Fetch Realtime Bookings for today
        const nowVn = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const todayStr = nowVn.toISOString().split('T')[0];
        const fromDate = `${todayStr}T00:00:00+07:00`;

        // 4. Determine Shift and Configs for Realtime Bonus
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .eq('key', 'holiday_shift2_dates');

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

        // 5. Fetch Realtime Bookings for today
        const { data: bookings } = await supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating, guestCount, createdAt,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options, handover_status, handover_comment )
            `)
            .gte('timeStart', fromDate)
            .not('status', 'in', '("CANCELLED","NEW")');

        const { data: services } = await supabase.from('Services').select('id, is_utility');
        const svcUtilityMap: Record<string, boolean> = {};
        (services || []).forEach(s => { svcUtilityMap[String(s.id)] = s.is_utility === true; });

        
        const bonusConfig = { s1Bonus, s2Bonus, s3Bonus, enableBonus };
        
        const { data: dConfigs } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
        const typeDConfigs: Record<string, any> = {};
        (dConfigs || []).forEach((c: any) => { typeDConfigs[c.key] = c.value; });
        const basePointsTypeD = Number(typeDConfigs['ktv_type_d_bonus_points']) || 20;
        const pointRateTypeD = Number(typeDConfigs['ktv_bonus_rate_TYPE_D']) || 1000;
        const enableBonusTypeD = typeDConfigs['enable_ktv_bonus_TYPE_D'] === true || typeDConfigs['enable_ktv_bonus_TYPE_D'] === 'true';


        
        let rt_bonus = 0;
        (bookings || []).forEach(b => {
            if (workType === 'TYPE_D') {
                if (enableBonusTypeD) {
                    const ktvWorkTypesForGuest: string[] = [];
                    (b.BookingItems || []).forEach((i: any) => {
                        if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                            i.technicianCodes.forEach((tc: string) => {
                                const wt = staffWorkTypeMap[tc.toLowerCase()] || 'TYPE_A';
                                ktvWorkTypesForGuest.push(wt);
                            });
                        }
                    });
                    const bonusPts = KtvTypeDBonusService.calculateBonusForTypeD(
                        ktvWorkTypesForGuest,
                        b.rating,
                        basePointsTypeD,
                        pointRateTypeD
                    );
                    rt_bonus += bonusPts;
                }
            } else {
                const bDate = new Date(b.timeStart || (b as any).createdAt || todayStr);
                const isNewRule = bDate >= new Date('2026-08-05T00:00:00+07:00');
                let bForBonus = b;
                if (!isNewRule) {
                    const filteredItemsForBonus = (b.BookingItems || []).filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
                    bForBonus = { ...b, BookingItems: filteredItemsForBonus };
                }
                const bonusPts = KtvCommissionService.calculateBookingBonus(bForBonus, techCode, todayStr, shiftsData || [], bonusConfig, staffWorkTypeMap, staffBonusMap, isNewRule);
                rt_bonus += bonusPts;
            }
        });


        // 4. Calculate Balance
        let totalPoints = (earns || []).reduce((sum: number, record: any) => sum + Number(record.total_bonus || 0), 0) + rt_bonus;
        
        (adjustments || []).forEach((tx: any) => {
            const amt = Number(tx.amount || 0);
            if (tx.type === 'GIFT' || amt > 0) totalPoints += Math.abs(amt);
            else totalPoints -= Math.abs(amt);
        });

        const totalRedeemed = (withdrawals || []).reduce((sum: number, record: any) => sum + (Number(record.amount || 0) / 1000), 0);
        
        totalPoints -= totalRedeemed;
        if (totalPoints < 0) totalPoints = 0;
        
        // Trả về kèm số điểm tương đương VNĐ
        return NextResponse.json({
            success: true,
            data: {
                points: totalPoints,
                vnd_value: totalPoints * 1000
            }
        });
    } catch (error: any) {
        console.error('Lỗi tính điểm bonus:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
