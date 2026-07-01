import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Internal core logic for syncing ledger
async function processLedgerSync(targetDateStr: string) {
    console.log(`[Cron] Syncing Daily Ledger for date: ${targetDateStr}`);

    // Boundaries in VN time
    const startTimeStr = `${targetDateStr}T00:00:00+07:00`;
    const endTimeStr = `${targetDateStr}T23:59:59.999+07:00`;

    // 1. Get configs from centralized service
    const commConfig = await KtvCommissionService.getCommissionConfig(supabase);
    const bonusConfig = await KtvCommissionService.getBonusConfig(supabase);

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
    const { data: holidayDatesRes } = await supabase.from('SystemConfigs').select('value').eq('key', 'holiday_shift2_dates').single();
    let holidayDates: any = [];
    if (holidayDatesRes?.value) {
        try { holidayDates = typeof holidayDatesRes.value === 'string' ? JSON.parse(holidayDatesRes.value) : holidayDatesRes.value; } catch { }
    }
    
    if (holidayDates && Array.isArray(holidayDates)) {
        const targetMonthDay = targetDateStr.slice(5, 10);
        if (holidayDates.includes(targetMonthDay)) {
            isHoliday = true;
        }
    }
    
    if (isHoliday) {
        ktvs.forEach(ktv => ktvShiftMap.set(ktv.id, 'SHIFT_2'));
    }
    
    // Convert to the array format that calculateBookingBonus expects
    const processedShiftsData = Array.from(ktvShiftMap.entries()).map(([employeeId, shiftType]) => ({
        employeeId,
        shiftType,
        effectiveFrom: targetDateStr
    }));

    // 3. Fetch Bookings for the target date
    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, timeStart, timeEnd, status, technicianCode, rating,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings )
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

    // 4.5 [DEPRECATED] Sudden Off penalty now handled directly in attendance API via WalletAdjustments
    // Kept as comment for audit trail. Penalty is deducted per-staff with feature_flags check.

    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

    const upsertRows = [];
    const bonusRecords: any[] = []; // kept for compatibility if needed later, but removed insertion

    // 5. Calculate per KTV
    for (const ktv of ktvs) {
        const techCode = ktv.id;
        let total_commission = 0;
        let total_tip = 0;
        let total_bonus = 0;
        let total_penalty = 0; // Penalty now handled via WalletAdjustments (attendance API)
        
        for (const b of validBookings) {
            const relevantItems = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes && Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
            );

            if (relevantItems.length === 0) continue;

            let bookingCommission = 0;
            for (const item of relevantItems) {
                const fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                if (itemDuration <= 0) itemDuration = 60;
                bookingCommission += KtvCommissionService.calcCommission(itemDuration, commConfig.milestones, commConfig.ratePer60);
            }

            total_commission += bookingCommission || KtvCommissionService.calcCommission(60, commConfig.milestones, commConfig.ratePer60);
            total_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
            
            // Bonus calculation via Service
            const bookingBonus = KtvCommissionService.calculateBookingBonus(b, techCode, targetDateStr, processedShiftsData, bonusConfig);
            total_bonus += bookingBonus;
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
