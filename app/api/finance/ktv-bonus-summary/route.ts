import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        let fromDate = searchParams.get('fromDate');
        const toDate = searchParams.get('toDate');

        // Yêu cầu: Lấy dữ liệu từ ngày 1/6/2026 trở đi khi ở lựa chọn "Tất cả"
        if (!fromDate) {
            fromDate = '2026-06-01';
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'No admin client' }, { status: 500 });

        // 1. Fetch Staff (only active ones)
        const { data: staffList, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, status, feature_flags')
            .eq('status', 'ĐANG LÀM')
            .ilike('id', 'NH%')
            .order('id', { ascending: true });

        if (staffError) throw staffError;

        // 1.5 Fetch Bonus config per shift via Service
        const bonusConfig = await KtvCommissionService.getBonusConfig(supabase);

        // HIỂN THỊ TẤT CẢ KTV ĐANG LÀM (KHÔNG BỊ PHỤ THUỘC VÀO CỜ BẬT VÍ)
        const staffIds = (staffList || []).map(s => s.id);

        if (staffIds.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // Fetch KTV shifts to determine bonus per KTV
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('employeeId, shiftType, effectiveFrom')
            .in('employeeId', staffIds)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });

        // 2. Fetch Earned Bonus from KTVDailyLedger
        let ledgerQuery = supabase
            .from('KTVDailyLedger')
            .select('staff_id, total_bonus')
            .in('staff_id', staffIds)
            .gt('total_bonus', 0);
            
        if (fromDate) ledgerQuery = ledgerQuery.gte('date', fromDate);
        if (toDate) ledgerQuery = ledgerQuery.lte('date', toDate);

        const { data: ledger, error: ledgerError } = await ledgerQuery;
        if (ledgerError) throw ledgerError;

        // 2.5 Fetch Realtime Bookings to calculate today's bonus
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const todayStr = new Date(Date.now() + VN_OFFSET_MS).toISOString().split('T')[0];
        
        let shouldFetchRealtime = true;
        if (toDate && toDate < todayStr) {
            shouldFetchRealtime = false;
        }

        let realtimeBookings: any[] = [];
        if (shouldFetchRealtime) {
            let bookingQuery = supabase
                .from('Bookings')
                .select(`
                    id, timeStart, timeEnd, status, technicianCode, rating,
                    BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, itemRating, ktvRatings )
                `)
                .in('status', ['DONE', 'FEEDBACK', 'CLEANING']);

            // Mốc mặc định lấy từ hôm nay (vì quá khứ đã nằm trong Sổ Cái)
            let rtStart = `${todayStr}T00:00:00+07:00`;
            if (fromDate && fromDate > todayStr) {
                 rtStart = `${fromDate}T00:00:00+07:00`;
            }
            bookingQuery = bookingQuery.gte('timeStart', rtStart);

            if (toDate) {
                 bookingQuery = bookingQuery.lte('timeStart', `${toDate}T23:59:59+07:00`);
            }

            const { data: bData } = await bookingQuery;
            realtimeBookings = bData || [];
        }

        // 3. Fetch Deducted Bonus from WalletAdjustments
        let adjQuery = supabase
            .from('WalletAdjustments')
            .select('staff_id, amount, type')
            .in('staff_id', staffIds)
            .eq('wallet_type', 'BONUS');
            
        if (fromDate) adjQuery = adjQuery.gte('created_at', `${fromDate}T00:00:00+07:00`);
        if (toDate) adjQuery = adjQuery.lte('created_at', `${toDate}T23:59:59+07:00`);

        const { data: adjustments, error: adjError } = await adjQuery;
        if (adjError) throw adjError;

        // 4. Fetch Redeemed Bonus from KTVWithdrawals
        let wthQuery = supabase
            .from('KTVWithdrawals')
            .select('staff_id, amount')
            .in('staff_id', staffIds)
            .eq('wallet_type', 'BONUS')
            .in('status', ['PENDING', 'APPROVED']); // Include pending to lock balance
            
        if (fromDate) wthQuery = wthQuery.gte('request_date', `${fromDate}T00:00:00+07:00`);
        if (toDate) wthQuery = wthQuery.lte('request_date', `${toDate}T23:59:59+07:00`);

        const { data: withdrawals, error: wthError } = await wthQuery;
        if (wthError) throw wthError;

        // 5. Aggregate data
        const statsMap: Record<string, { totalEarned: number, totalRedeemed: number, totalDeducted: number }> = {};
        staffIds.forEach(id => {
            statsMap[id] = { totalEarned: 0, totalRedeemed: 0, totalDeducted: 0 };
        });

        // Sum Earned from Ledger
        (ledger || []).forEach(tx => {
            if (statsMap[tx.staff_id]) {
                statsMap[tx.staff_id].totalEarned += Number(tx.total_bonus || 0);
            }
        });

        // Sum Earned from Realtime Bookings (ĐỒNG BỘ LOGIC VỚI API VÍ KTV bonus/balance)
        realtimeBookings.forEach(b => {
            // Collect all KTV codes in this booking
            const allKtvCodes = new Set<string>();
            for (const item of (b.BookingItems || [])) {
                if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                    item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
                }
            }

            // Per-KTV: tính rating và duration RIÊNG cho từng KTV bằng Service
            allKtvCodes.forEach(techCode => {
                const sId = staffIds.find(id => id.toLowerCase() === techCode);
                if (!sId || !statsMap[sId]) return;

                const bonusPts = KtvCommissionService.calculateBookingBonus(b, sId, todayStr, shiftsData || [], bonusConfig);
                statsMap[sId].totalEarned += bonusPts;
            });
        });

        // Sum Deducted / Gifted
        (adjustments || []).forEach(tx => {
            if (statsMap[tx.staff_id]) {
                const amt = Number(tx.amount || 0);
                // Thưởng thủ công thì cộng vào Earned
                if (tx.type === 'GIFT' || amt > 0) {
                    statsMap[tx.staff_id].totalEarned += Math.abs(amt);
                } 
                // Phạt thì cộng vào Deducted
                else {
                    statsMap[tx.staff_id].totalDeducted += Math.abs(amt);
                }
            }
        });

        (withdrawals || []).forEach(tx => {
            if (statsMap[tx.staff_id]) {
                statsMap[tx.staff_id].totalRedeemed += (Number(tx.amount || 0) / 1000);
            }
        });

        // 4. Format Output
        const result = (staffList || []).map(s => {
            const stats = statsMap[s.id];
            const currentBalance = stats.totalEarned - stats.totalRedeemed - stats.totalDeducted;
            return {
                id: s.id,
                name: s.full_name,
                totalEarned: stats.totalEarned,
                totalRedeemed: stats.totalRedeemed,
                totalDeducted: stats.totalDeducted,
                currentBalance: currentBalance > 0 ? currentBalance : 0,
                vndEquivalent: (currentBalance > 0 ? currentBalance : 0) * 1000 // 1 point = 1000đ
            };
        });

        return NextResponse.json({ success: true, data: result });
    } catch (err: any) {
        console.error('❌ [Finance KTV Bonus Summary] Error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
