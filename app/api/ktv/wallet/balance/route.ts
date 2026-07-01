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
        const techCode = searchParams.get('techCode');

        if (!techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';

        // 1. Fetch configs via Service
        const commConfig = await KtvCommissionService.getCommissionConfig(supabase);
        const bonusConfig = await KtvCommissionService.getBonusConfig(supabase);

        // --- CƠ CHẾ DYNAMIC BRIDGE ---
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // 2. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay)
        const { data: ledgers } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_commission, total_tip, total_bonus, total_penalty')
            .eq('staff_id', techCode)
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

        // Fetch Bookings with Pagination
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
                .in('status', ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING'])
                .range(page * pageSize, (page + 1) * pageSize - 1);
                
            if (error) {
                console.error("Pagination error balance:", error);
                break;
            }
            if (!data || data.length === 0) break;
            allBookings = allBookings.concat(data);
            page++;
        }
        const bookings = allBookings;

        // Fetch KTV shift for bonus calculation
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('employeeId, shiftType, effectiveFrom')
            .eq('employeeId', techCode)
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
        const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

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

            rt_commission += KtvCommissionService.calcCommission(totalDuration || 60, commConfig.milestones, commConfig.ratePer60);
            rt_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
            
            // Bonus calculation via Service
            rt_bonus += KtvCommissionService.calculateBookingBonus(b, techCode, todayStr, shiftsData || [], bonusConfig);
        }

        // 4. Fetch Adjustments (Luôn lấy từ GLOBAL_START_DATE_ISO để khớp Timeline, KHÔNG dùng ledger)
        const { data: adjustments } = await supabase
            .from('WalletAdjustments')
            .select('amount')
            .eq('staff_id', techCode)
            .gte('created_at', GLOBAL_START_DATE_ISO);
        const total_adjustment = (adjustments || []).reduce((sum, a) => sum + Number(a.amount), 0);

        // 5. Fetch Withdrawals (Luôn lấy từ GLOBAL_START_DATE_ISO để khớp Timeline, KHÔNG dùng ledger)
        const { data: withdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('amount, status, note')
            .eq('staff_id', techCode)
            .or('wallet_type.eq.TUA,wallet_type.is.null')
            .gte('request_date', GLOBAL_START_DATE_ISO);
            
        const total_withdrawn = (withdrawals || [])
            .filter(w => w.status === 'APPROVED' && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
            .reduce((sum, w) => sum + Math.abs(Number(w.amount)), 0);
            
        const total_pending = (withdrawals || [])
            .filter(w => w.status === 'PENDING' && !(Math.abs(Number(w.amount)) === 1 && w.note?.includes('Báo trước')))
            .reduce((sum, w) => sum + Math.abs(Number(w.amount)), 0);

        // 6. Calculate Final Balances (Kết hợp Ledger và Realtime)
        const total_commission = ledgerSummary.comm + rt_commission;
        const total_tip = ledgerSummary.tip + rt_tip;
        const total_bonus = ledgerSummary.bonus + rt_bonus;
        const total_penalty = 0; // Penalty now included in WalletAdjustments (total_adjustment)

        // ⚠️ Bonus KHÔNG cộng vào ví rút tiền — chỉ hiển thị ở lịch sử
        const gross_income = total_commission + total_adjustment;
        const net_balance = gross_income - total_withdrawn - total_pending;
        const available_balance = Math.max(0, net_balance - commConfig.minDeposit);
        const effective_balance = Math.max(0, net_balance);

        return NextResponse.json({
            success: true,
            data: {
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
            }
        });

    } catch (err: any) {
        console.error('Exception in /api/ktv/wallet/balance:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
