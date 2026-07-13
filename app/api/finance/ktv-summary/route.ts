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

        // 3. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay, ALL TIME)
        const { data: ledgers } = await supabase
            .from('KTVDailyLedger')
            .select('date, staff_id, total_commission, total_tip, total_bonus, total_penalty, total_adjustment, total_withdrawn')
            .gte('date', GLOBAL_START_DATE_STR);

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;
        const allTimeMap: Record<string, any> = {};
        const prevMap: Record<string, any> = {};
        const periodMap: Record<string, any> = {};
        
        ktvs.forEach(k => {
            allTimeMap[k.id] = { comm: 0, tip: 0, bonus: 0, penalty: 0 };
            prevMap[k.id] = { comm: 0, tip: 0, bonus: 0, penalty: 0 };
            periodMap[k.id] = { comm: 0, tip: 0, bonus: 0, penalty: 0 };
        });

        if (ledgers && ledgers.length > 0) {
            const pastLedgers = ledgers.filter(l => l.date < todayStr);
            
            if (pastLedgers.length > 0) {
                let maxDateStr = pastLedgers[0].date;
                pastLedgers.forEach(l => {
                    if (l.date > maxDateStr) maxDateStr = l.date;
                    const staffId = l.staff_id;
                    if (allTimeMap[staffId]) {
                        const comm = Number(l.total_commission || 0);
                        const tip = Number(l.total_tip || 0);
                        const bonus = Number(l.total_bonus || 0);
                        const penalty = Number(l.total_penalty || 0);

                        // All Time
                        allTimeMap[staffId].comm += comm;
                        allTimeMap[staffId].tip += tip;
                        allTimeMap[staffId].bonus += bonus;
                        allTimeMap[staffId].penalty += penalty;

                        // Period & Prev
                        if (fromDate && l.date < fromDate) {
                            prevMap[staffId].comm += comm;
                            prevMap[staffId].tip += tip;
                            prevMap[staffId].bonus += bonus;
                            prevMap[staffId].penalty += penalty;
                        } else if ((!fromDate || l.date >= fromDate) && (!toDate || l.date <= toDate)) {
                            periodMap[staffId].comm += comm;
                            periodMap[staffId].tip += tip;
                            periodMap[staffId].bonus += bonus;
                            periodMap[staffId].penalty += penalty;
                        }
                    }
                });

                const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
                const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
                const nextDateStr = nextDateVn.toISOString().split('T')[0];
                
                realtimeStartStr = `${nextDateStr}T00:00:00+07:00`;
            }
        }

        // 4. Fetch Realtime Bookings from realtimeStartStr (ALL TIME)
        const { data: bookings } = await supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings )
            `)
            .gte('timeStart', realtimeStartStr)
            .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING']);

        const { data: services } = await supabase.from('Services').select('id, duration');
        const svcDurationMap: Record<string, number> = {};
        (services || []).forEach(s => { svcDurationMap[String(s.id)] = s.duration || 60; });

        const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

        // 5. Fetch Realtime Adjustments and Withdrawals (ALL TIME)
        const { data: realtimeAdjustments } = await supabase
            .from('WalletAdjustments')
            .select('staff_id, amount, created_at')
            .gte('created_at', GLOBAL_START_DATE_ISO);

        const { data: realtimeWithdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount, status, request_date, note')
            .or('wallet_type.eq.TUA,wallet_type.is.null')
            .gte('request_date', GLOBAL_START_DATE_ISO);

        const { data: pendingWithdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount, note, request_date')
            .eq('status', 'PENDING')
            .or('wallet_type.eq.TUA,wallet_type.is.null')
            .gte('request_date', GLOBAL_START_DATE_ISO);

        // 6. Calculate per KTV
        const summaries = ktvs.map(ktv => {
            const techCode = ktv.id;
            let at_rt_commission = 0;
            let at_rt_tip = 0;
            let at_rt_bonus = 0;
            
            let period_rt_commission = 0;
            let period_rt_tip = 0;
            let period_rt_bonus = 0;
            
            let prev_rt_commission = 0;
            let prev_rt_tip = 0;
            let prev_rt_bonus = 0;

            for (const b of validBookings) {
                const relevantItems = (b.BookingItems || []).filter((i: any) =>
                    i.technicianCodes && Array.isArray(i.technicianCodes) &&
                    i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
                );

                if (relevantItems.length === 0) continue;

                let totalDuration = 0;
                for (const item of relevantItems) {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = 60;
                    totalDuration += itemDuration;
                }

                const bookingCommission = KtvCommissionService.calcCommission(totalDuration || 60, commConfig.milestones, commConfig.ratePer60);
                const bookingTip = relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
                const bookingBonus = KtvCommissionService.calculateBookingBonus(b, techCode, todayStr, shiftsData || [], bonusConfig);

                at_rt_commission += bookingCommission;
                at_rt_tip += bookingTip;
                at_rt_bonus += bookingBonus;

                const bookingDateVnStr = new Date(new Date(b.timeStart).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
                
                if (fromDate && bookingDateVnStr < fromDate) {
                    prev_rt_commission += bookingCommission;
                    prev_rt_tip += bookingTip;
                    prev_rt_bonus += bookingBonus;
                } else if ((!fromDate || bookingDateVnStr >= fromDate) && (!toDate || bookingDateVnStr <= toDate)) {
                    period_rt_commission += bookingCommission;
                    period_rt_tip += bookingTip;
                    period_rt_bonus += bookingBonus;
                }
            }

            // Adjustments
            const staffAdjs = (realtimeAdjustments || []).filter(a => a.staff_id === techCode);
            let at_adjustment = 0;
            let period_adjustment = 0;
            let prev_adjustment = 0;
            
            staffAdjs.forEach(a => {
                const amount = Number(a.amount);
                at_adjustment += amount;
                const adjDateVnStr = new Date(new Date(a.created_at).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
                
                if (fromDate && adjDateVnStr < fromDate) {
                    prev_adjustment += amount;
                } else if ((!fromDate || adjDateVnStr >= fromDate) && (!toDate || adjDateVnStr <= toDate)) {
                    period_adjustment += amount;
                }
            });

            // Withdrawals
            const staffWd = (realtimeWithdrawals || []).filter(w => w.staff_id === techCode && w.status === 'APPROVED');
            let at_withdrawn = 0;
            let period_withdrawn = 0;
            let prev_withdrawn = 0;

            staffWd.forEach(w => {
                const amount = Number(w.amount);
                at_withdrawn += amount;
                const wdDateVnStr = new Date(new Date(w.request_date).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
                
                if (fromDate && wdDateVnStr < fromDate) {
                    prev_withdrawn += amount;
                } else if ((!fromDate || wdDateVnStr >= fromDate) && (!toDate || wdDateVnStr <= toDate)) {
                    period_withdrawn += amount;
                }
            });

            const total_pending = (pendingWithdrawals || [])
                .filter(w => w.staff_id === techCode && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
                .reduce((sum, w) => sum + Number(w.amount), 0);
                
            let period_pending = 0;
            (pendingWithdrawals || []).filter(w => w.staff_id === techCode && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước'))).forEach(w => {
                const wdDateVnStr = new Date(new Date(w.request_date).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
                if ((!fromDate || wdDateVnStr >= fromDate) && (!toDate || wdDateVnStr <= toDate)) {
                    period_pending += Number(w.amount);
                }
            });

            // Calculate Period Metrics (For Display)
            const period_ledger = periodMap[techCode];
            const total_commission = period_ledger.comm + period_rt_commission;
            const total_tip = period_ledger.tip + period_rt_tip;
            const total_bonus = period_ledger.bonus + period_rt_bonus;
            const total_penalty = commConfig.isPenaltyEnabled ? period_ledger.penalty : 0;
            
            const gross_income = total_commission + period_adjustment - total_penalty;

            // Calculate Previous Balance
            const prev_ledger = prevMap[techCode];
            const prev_gross = (prev_ledger.comm + prev_rt_commission) + prev_adjustment - (commConfig.isPenaltyEnabled ? prev_ledger.penalty : 0);
            const previous_balance = prev_gross - prev_withdrawn;

            // Calculate All Time Metrics (For True Current Balance)
            const at_ledger = allTimeMap[techCode];
            const at_gross = (at_ledger.comm + at_rt_commission) + at_adjustment - (commConfig.isPenaltyEnabled ? at_ledger.penalty : 0);
            const net_balance = at_gross - at_withdrawn - total_pending;
            const min_deposit = commConfig.minDeposit;
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
                total_adjustment: period_adjustment,
                total_withdrawn: period_withdrawn,
                total_pending: period_pending,
                gross_income,
                previous_balance,
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
