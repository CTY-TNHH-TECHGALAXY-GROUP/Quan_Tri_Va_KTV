import { SupabaseClient } from '@supabase/supabase-js';
import { KtvCommissionService } from './KtvCommissionService';

export class KtvWalletService {
    static async getBalance(supabase: SupabaseClient, staffId: string) {
        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        
        // 1. Get staff info (work_type)
        const { data: staffData } = await supabase.from('Staff').select('work_type').eq('id', staffId).single();
        const workType = staffData?.work_type || 'TYPE_A';

        // 2. Fetch configs
        const commConfig = await KtvCommissionService.getCommissionConfig(supabase, workType as any);
        const bonusConfig = await KtvCommissionService.getBonusConfig(supabase);

        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // 3. Fetch Ledger
        const { data: ledgers } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_commission, total_tip, total_bonus, total_penalty')
            .eq('staff_id', staffId)
            .gte('date', GLOBAL_START_DATE_STR);

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;
        const ledgerSummary = { comm: 0, tip: 0, bonus: 0, penalty: 0 };

        if (ledgers && ledgers.length > 0) {
            const pastLedgers = ledgers.filter(l => l.date < todayStr);
            if (pastLedgers.length > 0) {
                let maxDateStr = pastLedgers[0].date;
                pastLedgers.forEach(l => {
                    if (l.date > maxDateStr) maxDateStr = l.date;
                    ledgerSummary.comm += Number(l.total_commission);
                    ledgerSummary.tip += Number(l.total_tip);
                    ledgerSummary.bonus += Number(l.total_bonus || 0);
                    ledgerSummary.penalty += Number(l.total_penalty || 0);
                });

                const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
                const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
                const nextDateStr = nextDateVn.toISOString().split('T')[0];
                realtimeStartStr = `${nextDateStr}T00:00:00+07:00`;
            }
        }

        // 4. Fetch Bookings
        let allBookings: any[] = [];
        let page = 0;
        const pageSize = 1000;
        while (true) {
            const { data, error } = await supabase
                .from('Bookings')
                .select(`
                    id, timeStart, status, billCode, createdAt, rating,
                    BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings )
                `)
                .gte('timeStart', realtimeStartStr)
                .in('status', ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'])
                .range(page * pageSize, (page + 1) * pageSize - 1);
                
            if (error || !data || data.length === 0) break;
            allBookings = allBookings.concat(data);
            page++;
        }

        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('employeeId, shiftType, effectiveFrom')
            .eq('employeeId', staffId)
            .lte('effectiveFrom', todayStr)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });

        const { data: services } = await supabase.from('Services').select('id, duration');
        const svcDurationMap: Record<string, number> = {};
        (services || []).forEach(s => { svcDurationMap[String(s.id)] = s.duration || 60; });

        let rt_commission = 0;
        let rt_tip = 0;
        let rt_bonus = 0;

        for (const b of allBookings) {
            const relevantItems = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes && Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(staffId.toLowerCase()))
            );

            if (relevantItems.length === 0) continue;

            let bookingCommission = 0;
            for (const item of relevantItems) {
                const fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                let itemDuration = KtvCommissionService.calculateItemDuration(item, staffId, fallbackDuration);
                if (itemDuration <= 0) itemDuration = 60;
                bookingCommission += KtvCommissionService.calcCommission(itemDuration, commConfig.milestones, commConfig.ratePer60);
            }

            if (bookingCommission === 0) {
                bookingCommission = KtvCommissionService.calcCommission(60, commConfig.milestones, commConfig.ratePer60);
            }

            // Fixed order bonus cho TYPE_B
            if (workType === 'TYPE_B') {
                const fixedOrderBonus = commConfig.fixedOrderBonus || 20000;
                const allKtvCodes = new Set<string>();
                for (const item of (b.BookingItems || [])) {
                    (item.technicianCodes || []).forEach((tc: string) => allKtvCodes.add(tc));
                }
                const totalKtvs = allKtvCodes.size || 1;
                bookingCommission += Math.floor(fixedOrderBonus / totalKtvs);
            }

            rt_commission += bookingCommission;
            rt_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
            rt_bonus += KtvCommissionService.calculateBookingBonus(b, staffId, todayStr, shiftsData || [], bonusConfig);
        }

        // 5. Adjustments & Withdrawals
        const { data: adjustments } = await supabase
            .from('WalletAdjustments')
            .select('amount')
            .eq('staff_id', staffId)
            .gte('created_at', GLOBAL_START_DATE_ISO);
        const total_adjustment = (adjustments || []).reduce((sum, a) => sum + Number(a.amount), 0);

        const { data: withdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('amount, status, note')
            .eq('staff_id', staffId)
            .or('wallet_type.eq.TUA,wallet_type.is.null')
            .gte('request_date', GLOBAL_START_DATE_ISO);
            
        const total_withdrawn = (withdrawals || [])
            .filter(w => w.status === 'APPROVED' && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
            .reduce((sum, w) => sum + Math.abs(Number(w.amount)), 0);
            
        const total_pending = (withdrawals || [])
            .filter(w => w.status === 'PENDING' && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
            .reduce((sum, w) => sum + Math.abs(Number(w.amount)), 0);

        const total_commission = ledgerSummary.comm + rt_commission;
        const total_tip = ledgerSummary.tip + rt_tip;
        const total_bonus = ledgerSummary.bonus + rt_bonus;
        const total_penalty = 0; 

        const gross_income = total_commission + total_adjustment;
        const net_balance = gross_income - total_withdrawn - total_pending;
        const available_balance = Math.max(0, net_balance - commConfig.minDeposit);
        const effective_balance = Math.max(0, net_balance);

        return {
            total_commission,
            total_tip,
            total_bonus,
            total_penalty,
            total_adjustment,
            total_withdrawn,
            total_pending,
            gross_income,
            min_deposit: commConfig.minDeposit,
            net_balance,
            available_balance,
            effective_balance,
            bonus_wallet_total: total_bonus,
            bonus_wallet_enabled: commConfig.isBonusWalletEnabled
        };
    }
}
