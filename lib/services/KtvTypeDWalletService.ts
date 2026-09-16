import { SupabaseClient } from '@supabase/supabase-js';
import { KtvTypeDCommissionService } from './KtvTypeDCommissionService';
import { KtvTypeDBonusService } from './KtvTypeDBonusService';

export class KtvTypeDWalletService {
    static async getBalance(supabase: SupabaseClient, staffId: string) {
        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        
        const { data: configsData } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
        const configs: Record<string, any> = {};
        (configsData || []).forEach((c: any) => { configs[c.key] = c.value; });

        const rateVIP = Number(configs['ktv_type_d_vip_rate_per_60m']) || 180000;
        const ratePT = Number(configs['ktv_type_d_pt_rate_per_60m']) || 100000;
        
        let ratingDeductions = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
        try {
            if (configs['ktv_type_d_rating_deduction']) {
                ratingDeductions = typeof configs['ktv_type_d_rating_deduction'] === 'string' 
                    ? JSON.parse(configs['ktv_type_d_rating_deduction']) 
                    : configs['ktv_type_d_rating_deduction'];
            }
        } catch (e) {}

        const basePoints = Number(configs['ktv_type_d_bonus_points']) || 20;
        const pointRate = Number(configs['ktv_bonus_rate_TYPE_D']) || 1000;
        const enableBonus = configs['enable_ktv_bonus_TYPE_D'] === true || configs['enable_ktv_bonus_TYPE_D'] === 'true';
        const minDeposit = Number(configs['ktv_deposit_amount_TYPE_D']) || 1000000;

        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        const { data: ledgers } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_commission, total_tip, total_bonus, total_penalty')
            .eq('staff_id', staffId)
            .eq('work_type_snapshot', 'TYPE_D')
            .gte('date', GLOBAL_START_DATE_STR);

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;
        const ledgerSummary = { comm: 0, tip: 0, bonus: 0, penalty: 0 };

        if (ledgers && ledgers.length > 0) {
            const pastLedgers = ledgers.filter((l: any) => l.date < todayStr);
            if (pastLedgers.length > 0) {
                let maxDateStr = pastLedgers[0].date;
                pastLedgers.forEach((l: any) => {
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

        let allBookings: any[] = [];
        let page = 0;
        const pageSize = 1000;
        while (true) {
            const { data, error } = await supabase
                .from('Bookings')
                .select(`
                    id, timeStart, status, billCode, createdAt, rating,
                    BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options, handover_status, handover_comment )
                `)
                .gte('timeStart', realtimeStartStr)
                .range(page * pageSize, (page + 1) * pageSize - 1);
                
            if (error || !data || data.length === 0) break;
            allBookings = allBookings.concat(data);
            page++;
        }

        const { data: services } = await supabase.from('Services').select('id, is_utility');
        const svcIsUtilityMap: Record<string, boolean> = {};
        (services || []).forEach((s: any) => { svcIsUtilityMap[String(s.id)] = !!s.is_utility; });

        const allTechCodes = new Set<string>();
        allBookings.forEach((b: any) => {
            (b.BookingItems || []).forEach((i: any) => {
                if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                    i.technicianCodes.forEach((tc: string) => allTechCodes.add(tc));
                }
            });
        });
        const { data: allTechData } = await supabase.from('Staff').select('id, work_type').in('id', Array.from(allTechCodes));
        const techWorkTypeMap: Record<string, string> = {};
        (allTechData || []).forEach((t: any) => { techWorkTypeMap[t.id.toLowerCase()] = t.work_type; });

        let rt_commission = 0;
        let rt_tip = 0;
        let rt_bonus = 0;

        for (const b of allBookings) {
            const relevantItemsOriginal = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes && Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(staffId.toLowerCase())) &&
                ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'].includes(i.status)
            );

            let relevantItems = relevantItemsOriginal.filter((i: any) => !svcIsUtilityMap[String(i.serviceId)]);
            if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
                relevantItems = relevantItemsOriginal;
            }

            if (relevantItems.length === 0) continue;

            const vipItems = relevantItems.filter((i: any) => {
                const svcId = String(i.serviceId).toUpperCase();
                return svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP');
            });
            const ptItems = relevantItems.filter((i: any) => {
                const svcId = String(i.serviceId).toUpperCase();
                return !(svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP'));
            });

            const vipCommission = KtvTypeDCommissionService.calculateGuestCommission(vipItems, staffId, b.rating, rateVIP, ratingDeductions);
            const ptCommission = KtvTypeDCommissionService.calculateGuestCommission(ptItems, staffId, b.rating, ratePT, ratingDeductions);

            rt_commission += vipCommission + ptCommission;

            let bookingTip = 0;
            relevantItems.forEach((i: any) => bookingTip += (Number(i.tip) || 0));
            rt_tip += bookingTip;

            if (enableBonus) {
                const ktvWorkTypesForGuest: string[] = [];
                (b.BookingItems || []).forEach((i: any) => {
                    if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                        i.technicianCodes.forEach((tc: string) => {
                            const wt = techWorkTypeMap[tc.toLowerCase()] || 'TYPE_A';
                            // Wait, logic in Bonus says: ktvWorkTypes array of all KTVs that served this guest
                            // KtvTypeDBonusService will check if any has != 'TYPE_D'.
                            ktvWorkTypesForGuest.push(wt);
                        });
                    }
                });
                
                rt_bonus += KtvTypeDBonusService.calculateBonusForTypeD(
                    ktvWorkTypesForGuest,
                    b.rating,
                    basePoints,
                    pointRate
                );
            }
        }

        const { data: adjustments } = await supabase
            .from('WalletAdjustments')
            .select('amount')
            .eq('staff_id', staffId)
            .eq('work_type_snapshot', 'TYPE_D')
            .gte('created_at', GLOBAL_START_DATE_ISO);
        const total_adjustment = (adjustments || []).reduce((sum: number, a: any) => sum + Number(a.amount), 0);

        const { data: withdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('amount, status, note')
            .eq('staff_id', staffId)
            .eq('work_type_snapshot', 'TYPE_D')
            .gte('request_date', GLOBAL_START_DATE_ISO);
            
        const total_withdrawn = (withdrawals || [])
            .filter((w: any) => w.status === 'APPROVED' && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Bảo trì')))
            .reduce((sum: number, w: any) => sum + Math.abs(Number(w.amount)), 0);
            
        const total_pending = (withdrawals || [])
            .filter((w: any) => w.status === 'PENDING' && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Bảo trì')))
            .reduce((sum: number, w: any) => sum + Math.abs(Number(w.amount)), 0);

        const total_commission = ledgerSummary.comm + rt_commission;
        const total_tip = ledgerSummary.tip + rt_tip;
        const total_bonus = ledgerSummary.bonus + rt_bonus;
        const total_penalty = 0; 

        const gross_income = total_commission + total_adjustment;
        const net_balance = gross_income - total_withdrawn - total_pending;
        const available_balance = Math.max(0, net_balance - minDeposit);
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
            min_deposit: minDeposit,
            net_balance,
            available_balance,
            effective_balance,
            bonus_wallet_total: total_bonus,
            bonus_wallet_enabled: enableBonus
        };
    }


}
