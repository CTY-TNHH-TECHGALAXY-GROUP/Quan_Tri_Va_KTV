import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvWalletService } from '@/lib/services/KtvWalletService';
import { KtvTypeDCommissionService } from '@/lib/services/KtvTypeDCommissionService';

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

        // ─── Resolve workType from Staff (Mới nhất) ───
        let workType = 'TYPE_A'; // Default
        const { data: staffData } = await supabase.from('Staff')
            .select('work_type').eq('id', techCode).single();
        if (staffData && staffData.work_type) {
            workType = staffData.work_type;
        }

        const commConfigs = await KtvCommissionService.getAllConfigs(supabase);
        let rateVIP = 180000;
        let ratePT = 100000;
        let ratingDeductions: Record<string, number> = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
        if (workType === 'TYPE_D') {
            const { data: configsData } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
            const configs: Record<string, any> = {};
            (configsData || []).forEach(c => { configs[c.key] = c.value; });
            rateVIP = Number(configs['ktv_type_d_vip_rate_per_60m']) || 180000;
            ratePT = Number(configs['ktv_type_d_pt_rate_per_60m']) || 100000;
            try {
                if (configs['ktv_type_d_rating_deduction']) {
                    ratingDeductions = typeof configs['ktv_type_d_rating_deduction'] === 'string' 
                        ? JSON.parse(configs['ktv_type_d_rating_deduction']) 
                        : configs['ktv_type_d_rating_deduction'];
                }
            } catch (e) {}
        }

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const START_DATE = `${GLOBAL_START_DATE_STR}T00:00:00.000Z`;
        const timeline: any[] = [];

        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // 1. Fetch Ledger (Chỉ lấy các ngày trước ngày hôm nay để tránh đụng độ Realtime)
        const { data: ledgers } = await KtvWalletService.applySnapshotFilter(
            supabase.from('KTVDailyLedger').select('date, total_commission, total_tip').eq('staff_id', techCode),
            workType
        )
            .gte('date', GLOBAL_START_DATE_STR);

        let realtimeStartStr = `${GLOBAL_START_DATE_STR}T00:00:00+07:00`;

        if (ledgers && ledgers.length > 0) {
            const pastLedgers = ledgers.filter((l: any) => l.date < todayStr);
            
            if (pastLedgers.length > 0) {
                let maxDateStr = pastLedgers[0].date;
                pastLedgers.forEach((l: any) => {
                    if (l.date > maxDateStr) maxDateStr = l.date;
                    
                    if (Number(l.total_commission) > 0) {
                        timeline.push({
                            id: `ledger_comm_${l.date}`,
                            type: 'COMMISSION',
                            title: `Tổng tiền tua ngày ${l.date.split('-').reverse().join('/')}`,
                            amount: Number(l.total_commission),
                            note: 'Chốt sổ cái',
                            created_at: `${l.date}T23:59:59+07:00`,
                            status: 'APPROVED'
                        });
                    }
                    if (Number(l.total_tip) > 0) {
                        timeline.push({
                            id: `ledger_tip_${l.date}`,
                            type: 'TIP',
                            title: `Tổng tiền tip ngày ${l.date.split('-').reverse().join('/')}`,
                            amount: Number(l.total_tip),
                            note: 'Chốt sổ cái',
                            created_at: `${l.date}T23:59:59+07:00`,
                            status: 'APPROVED'
                        });
                    }
                });

                const lastDateMs = new Date(`${maxDateStr}T00:00:00+07:00`).getTime();
                const nextDateVn = new Date(lastDateMs + 24 * 60 * 60 * 1000 + VN_OFFSET_MS);
                const nextDateStr = nextDateVn.toISOString().split('T')[0];
                
                realtimeStartStr = `${nextDateStr}T00:00:00+07:00`;
            }
        }

        // 2. Commission & Tips (from Bookings & BookingItems) CHỈ lấy từ ngày hiện tại
        let allBookings: any[] = [];
        let page = 0;
        const pageSize = 1000;
        
        while (true) {
            const { data, error } = await supabase
                .from('Bookings')
                .select(`
                    id, timeStart, timeEnd, status, technicianCode, billCode, createdAt,
                    BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options, handover_status, handover_comment )
                `)
                .gte('timeStart', realtimeStartStr)
                .not('status', 'in', '("CANCELLED","NEW")')
                .range(page * pageSize, (page + 1) * pageSize - 1);
                
            if (error) {
                console.error("Pagination error timeline:", error);
                break;
            }
            if (!data || data.length === 0) break;
            allBookings = allBookings.concat(data);
            page++;
        }
        const bookings = allBookings;

        const { data: services } = await supabase.from('Services').select('id, duration, is_utility');
        const svcDurationMap: Record<string, number> = {};
        const svcUtilityMap: Record<string, boolean> = {};
        (services || []).forEach(s => { 
            svcDurationMap[String(s.id)] = s.duration || 0; 
            svcUtilityMap[String(s.id)] = !!s.is_utility; 
        });

        const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

        for (const b of validBookings) {
            // 🧠 Filter theo ITEM STATUS thay vì Booking cha — triệt tiêu kẹt tiền
            const DONE_STATUSES = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
            const relevantItemsOriginal = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes &&
                Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase())) &&
                DONE_STATUSES.includes(i.status)
            );

            let relevantItems = relevantItemsOriginal.filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
            if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
                relevantItems = relevantItemsOriginal;
            }

            if (relevantItems.length === 0) continue;

            let passedDuration = 0;
            let passedCommission = 0;
            let heldDuration = 0;
            let heldCommission = 0;
            let allHoldReasons = new Set<string>();
            let passedCount = 0;

            
            if (workType === 'TYPE_D') {
                const vipItems = relevantItems.filter((i: any) => {
                    const svcId = String(i.serviceId).toUpperCase();
                    return svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP');
                });
                const ptItems = relevantItems.filter((i: any) => {
                    const svcId = String(i.serviceId).toUpperCase();
                    return !(svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP'));
                });
                
                passedCommission = KtvTypeDCommissionService.calculateGuestCommission(vipItems, techCode, b.rating, rateVIP, ratingDeductions) + 
                                   KtvTypeDCommissionService.calculateGuestCommission(ptItems, techCode, b.rating, ratePT, ratingDeductions);
                
                // For TYPE_D, we don't hold commission (no HOLD logic defined in requirements)
                heldCommission = 0;
                
                // Approximate passedDuration
                passedDuration = relevantItems.reduce((sum: number, item: any) => {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    return sum + (itemDuration <= 0 ? 60 : itemDuration);
                }, 0);
                
                passedCount = relevantItems.length;
            } else {
                for (const item of relevantItems) {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = 60;
                    
                    const commissionForItem = KtvCommissionService.calcCommission(itemDuration, commConfigs, workType, item.serviceId);

                    const { isPassed, reasons } = KtvCommissionService.checkIsItemPassed(item, b, techCode);
                    
                    if (isPassed) {
                        passedDuration += itemDuration;
                        passedCommission += commissionForItem;
                        passedCount++;
                    } else {
                        heldDuration += itemDuration;
                        heldCommission += commissionForItem;
                        reasons.forEach(r => allHoldReasons.add(r));
                    }
                }
                
                // Fallback for TYPE_A if total passed commission is 0 but they did work
                if (passedCommission === 0 && passedCount > 0) {
                    passedCommission = KtvCommissionService.calcCommission(60, commConfigs, workType, '');
                }
                if (heldCommission === 0 && relevantItems.length > passedCount && passedCount === 0) {
                    heldCommission = KtvCommissionService.calcCommission(60, commConfigs, workType, '');
                }
            }


            if (passedCommission > 0) {
                timeline.push({
                    id: b.id + '_comm_passed',
                    type: 'COMMISSION',
                    title: `Tiền tua đơn ${b.billCode || b.id.substring(0,6)}`,
                    amount: passedCommission,
                    note: `Tổng thời gian: ${passedDuration} phút`,
                    created_at: b.timeStart || (b as any).createdAt,
                    status: 'APPROVED'
                });
            }

            if (heldCommission > 0) {
                timeline.push({
                    id: b.id + '_comm_held',
                    type: 'COMMISSION',
                    title: `Tiền tua đơn ${b.billCode || b.id.substring(0,6)} (Đang tạm giữ)`,
                    amount: heldCommission,
                    note: Array.from(allHoldReasons).join(', '),
                    created_at: b.timeStart || (b as any).createdAt,
                    status: 'HELD'
                });
            }

            const ktvTip = relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);
            if (ktvTip > 0) {
                timeline.push({
                    id: b.id + '_tip',
                    type: 'TIP',
                    title: `Tiền Tip đơn ${b.billCode || b.id.substring(0,6)}`,
                    amount: ktvTip,
                    note: '',
                    created_at: b.timeEnd || b.createdAt,
                    status: 'APPROVED'
                });
            }
        }

        // 3. Adjustments
        const { data: adjustments } = await KtvWalletService.applySnapshotFilter(
            supabase.from('WalletAdjustments').select('id, amount, reason, type, created_at').eq('staff_id', techCode),
            workType
        )
            .gte('created_at', START_DATE);
        
        (adjustments || []).forEach((a: any) => {
            // Smart title based on reason content
            let title = Number(a.amount) >= 0 ? 'Thưởng hệ thống' : 'Trừ tiền hệ thống';
            const reason = (a.reason || '').toLowerCase();
            if (reason.includes('giặt đồ')) title = '🧦 Giặt đồ hàng ngày';
            else if (reason.includes('nghỉ đột xuất')) title = '⚠️ Phạt nghỉ đột xuất';

            timeline.push({
                id: a.id,
                type: Number(a.amount) >= 0 ? 'GIFT' : 'ADJUSTMENT',
                title,
                amount: a.amount,
                note: a.reason || '',
                created_at: a.created_at,
                status: 'APPROVED'
            });
        });

        // 4. Withdrawals
        const { data: withdrawals } = await KtvWalletService.applySnapshotFilter(
            supabase.from('KTVWithdrawals').select('id, amount, note, request_date, status').eq('staff_id', techCode),
            workType
        )
            .or('wallet_type.eq.TUA,wallet_type.is.null')
            .gte('request_date', START_DATE);

        (withdrawals || []).forEach((w: any) => {
            const isIntent = Math.abs(Number(w.amount)) === 1 && w.note && w.note.includes('Báo trước');
            if (isIntent) return; // Ẩn giao dịch "Báo trước" khỏi timeline của KTV
            
            timeline.push({
                id: w.id,
                type: 'WITHDRAWAL',
                title: 'Rút tiền mặt',
                amount: -Math.abs(Number(w.amount)),
                note: w.note || '',
                created_at: w.request_date,
                status: w.status
            });
        });

        // Sort timeline asc by created_at to calculate running balance
        timeline.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        let currentBalance = 0;
        const activeConfig = commConfigs[workType] || commConfigs['TYPE_A'];
        timeline.forEach(item => {
            if (item.type !== 'TIP' && item.status !== 'REJECTED') {
                currentBalance += Number(item.amount);
            }
            item.running_balance = currentBalance - activeConfig.minDeposit;
        });

        // Sort timeline desc for display
        timeline.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return NextResponse.json({ success: true, data: timeline });
    } catch (err: any) {
        console.error('Exception timeline:', err);
        return NextResponse.json({ success: false, error: 'Internal Error' }, { status: 500 });
    }
}
