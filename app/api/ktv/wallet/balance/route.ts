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

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');

        if (!techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';

        // 1. Fetch configs
        const [{ data: milestoneConf }, { data: rateConf }, { data: depositConf }, { data: bonusConfigs }, { data: penaltyConf }, { data: bonusWalletConf }] = await Promise.all([
            supabase.from('SystemConfigs').select('value').eq('key', 'ktv_commission_milestones').single(),
            supabase.from('SystemConfigs').select('value').eq('key', 'ktv_commission_per_60min').single(),
            supabase.from('SystemConfigs').select('value').eq('key', 'ktv_min_deposit').single(),
            supabase.from('SystemConfigs').select('key, value').in('key', ['ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus']),
            supabase.from('SystemConfigs').select('value').eq('key', 'enable_penalty_deduction').single(),
            supabase.from('SystemConfigs').select('value').eq('key', 'enable_bonus_wallet').single()
        ]);
        
        let milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
        let ratePer60 = 100000;
        let min_deposit = 500000;
        
        if (milestoneConf?.value) { try { milestones = typeof milestoneConf.value === 'string' ? JSON.parse(milestoneConf.value) : milestoneConf.value; } catch { } }
        if (rateConf?.value) {
            const rawRate = String(rateConf.value).replace(/[^0-9]/g, '');
            if (rawRate) ratePer60 = Number(rawRate);
        }
        // Bonus config per shift
        const bonusMap: Record<string, number> = {};
        (bonusConfigs || []).forEach((c: any) => { bonusMap[c.key] = Number(c.value) || 20; });
        const s1Bonus = bonusMap['ktv_shift_1_bonus'] || 20;
        const s2Bonus = bonusMap['ktv_shift_2_bonus'] || 20;
        const s3Bonus = bonusMap['ktv_shift_3_bonus'] || 40;

        if (depositConf?.value) {
            const rawDeposit = String(depositConf.value).replace(/[^0-9]/g, '');
            if (rawDeposit) min_deposit = Number(rawDeposit);
        }
        
        const isPenaltyEnabled = penaltyConf?.value === 'true';
        const isBonusWalletEnabled = String(bonusWalletConf?.value || '').replace(/"/g, '') === 'true';

        // --- CƠ CHẾ DYNAMIC BRIDGE (Đã fix lỗi trùng lặp dữ liệu) ---
        // Lấy ngày hiện tại ở Việt Nam (YYYY-MM-DD) — dùng cách tính giống cron job
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // 2. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay để tránh đụng độ Realtime)
        const { data: ledgers } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_commission, total_tip, total_bonus, total_penalty')
            .eq('staff_id', techCode)
            .gte('date', GLOBAL_START_DATE_STR);

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;
        const ledgerSummary = { comm: 0, tip: 0, bonus: 0, penalty: 0 };

        if (ledgers && ledgers.length > 0) {
            // LOẠI BỎ Sổ cái của ngày hôm nay (nếu có) do Cron hoặc Admin chạy tay sinh ra
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

                // Tính toán chính xác ngày tiếp theo mà không bị lệch múi giờ
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
                    id, timeStart, status, billCode, createdAt,
                    BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating )
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
            .select('shiftType, effectiveFrom')
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

            rt_commission += calcCommission(totalDuration || 60, milestones, ratePer60);
            rt_tip += relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);

            // Bonus: tính điểm thưởng per booking (chia đều unique KTVs, Math.floor)
            const bRating = Number(b.rating) || 0;
            const maxItemRating = Math.max(...(b.BookingItems || []).map((i: any) => Number(i.itemRating) || 0), 0);
            const bookingRating = Math.max(bRating, maxItemRating);

            if (bookingRating >= 4) {
                const bookingDateStr = b.timeStart ? b.timeStart.slice(0, 10) : todayStr;
                let currentShift = 'SHIFT_1';
                for (const s of (shiftsData || [])) {
                    const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                    if (effDate && effDate <= bookingDateStr) {
                        currentShift = s.shiftType;
                    }
                }

                let adjustedBasePoints = s1Bonus;
                if (currentShift === 'SHIFT_2') adjustedBasePoints = s2Bonus;
                else if (currentShift === 'SHIFT_3') adjustedBasePoints = s3Bonus;

                if (totalDuration < 60) {
                    adjustedBasePoints = adjustedBasePoints / 2;
                }

                // Collect ALL unique KTVs across ALL items in this booking
                const allKtvCodes = new Set<string>();
                for (const item of (b.BookingItems || [])) {
                    if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                        item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
                    }
                }
                const totalUniqueKTVs = allKtvCodes.size || 1;
                rt_bonus += Math.floor(adjustedBasePoints / totalUniqueKTVs);
            }
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
        const available_balance = Math.max(0, net_balance - min_deposit);
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
                min_deposit,
                net_balance,
                available_balance,
                effective_balance,
                bonus_wallet_total: total_bonus,
                bonus_wallet_enabled: isBonusWalletEnabled
            }
        });

    } catch (err: any) {
        console.error('Exception in /api/ktv/wallet/balance:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

