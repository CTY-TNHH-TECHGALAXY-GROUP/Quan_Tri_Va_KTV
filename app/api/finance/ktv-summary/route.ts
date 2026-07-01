import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const fromDate = searchParams.get('fromDate');
        const toDate = searchParams.get('toDate');

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';

        // 1. Get configs from centralized service
        const commConfig = await KtvCommissionService.getCommissionConfig(supabase);
        const bonusConfig = await KtvCommissionService.getBonusConfig(supabase);

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

        // --- CƠ CHẾ DYNAMIC BRIDGE ---
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // 3. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay)
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

                const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
                const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
                const nextDateStr = nextDateVn.toISOString().split('T')[0];
                
                realtimeStartStr = `${nextDateStr}T00:00:00+07:00`;
            }
        }

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

        const { data: realtimeWithdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount, status')
            .or('wallet_type.eq.TUA,wallet_type.is.null')
            .gte('request_date', GLOBAL_START_DATE_ISO);

        const { data: pendingWithdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount, note')
            .eq('status', 'PENDING')
            .or('wallet_type.eq.TUA,wallet_type.is.null')
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

                let bookingCommission = 0;
                for (const item of relevantItems) {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = 60;
                    bookingCommission += KtvCommissionService.calcCommission(itemDuration, commConfig.milestones, commConfig.ratePer60);
                }

                rt_commission += bookingCommission || KtvCommissionService.calcCommission(60, commConfig.milestones, commConfig.ratePer60);
                rt_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);

                // Calculate Bonus using Service
                rt_bonus += KtvCommissionService.calculateBookingBonus(b, techCode, todayStr, shiftsData || [], bonusConfig);
            }

            const rt_adjustment = (realtimeAdjustments || []).filter(a => a.staff_id === techCode).reduce((sum, a) => sum + Number(a.amount), 0);
            const rt_withdrawn = (realtimeWithdrawals || []).filter(w => w.staff_id === techCode && w.status === 'APPROVED').reduce((sum, w) => sum + Number(w.amount), 0);
            const total_pending = (pendingWithdrawals || [])
                .filter(w => w.staff_id === techCode && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
                .reduce((sum, w) => sum + Number(w.amount), 0);

            const ledger = ledgerMap[techCode];
            const total_commission = ledger.comm + rt_commission;
            const total_tip = ledger.tip + rt_tip;
            const total_bonus = ledger.bonus + rt_bonus;
            const total_penalty = commConfig.isPenaltyEnabled ? ledger.penalty : 0;

            const gross_income = total_commission + rt_adjustment - total_penalty;
            const min_deposit = commConfig.minDeposit;
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
