import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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

        // 1.5 Fetch Bonus config per shift
        const { data: bonusConfigs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus']);
        
        const bonusMap: Record<string, number> = {};
        (bonusConfigs || []).forEach((c: any) => { bonusMap[c.key] = Number(c.value) || 20; });
        const s1Bonus = bonusMap['ktv_shift_1_bonus'] || 20;
        const s2Bonus = bonusMap['ktv_shift_2_bonus'] || 20;
        const s3Bonus = bonusMap['ktv_shift_3_bonus'] || 40;

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
            const totalUniqueKTVs = allKtvCodes.size || 1;

            // Per-KTV: tính rating và duration RIÊNG cho từng KTV
            allKtvCodes.forEach(techCode => {
                const sId = staffIds.find(id => id.toLowerCase() === techCode);
                if (!sId || !statsMap[sId]) return;

                // 1. Tính rating riêng cho KTV này (giống wallet API)
                let maxKtvRating = 0;
                for (const item of (b.BookingItems || [])) {
                    const isTechInvolved = item.technicianCodes && Array.isArray(item.technicianCodes) &&
                        item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode);

                    if (isTechInvolved) {
                        let ktvRating = 0;
                        // Fallback chain: ktvRatings → itemRating → booking.rating
                        let parsedKtvRatings = (item as any).ktvRatings;
                        if (typeof parsedKtvRatings === 'string') {
                            try { parsedKtvRatings = JSON.parse(parsedKtvRatings); } catch { parsedKtvRatings = {}; }
                        }
                        if (parsedKtvRatings && typeof parsedKtvRatings === 'object') {
                            const key = Object.keys(parsedKtvRatings).find(k => k.toLowerCase() === techCode);
                            if (key) ktvRating = Number(parsedKtvRatings[key]) || 0;
                        }
                        if (ktvRating === 0) ktvRating = Number(item.itemRating) || 0;
                        if (ktvRating === 0) ktvRating = Number(b.rating) || 0;
                        if (ktvRating > maxKtvRating) maxKtvRating = ktvRating;
                    }
                }

                if (maxKtvRating < 4) return; // Không đủ rating → bỏ qua

                // 2. Tính duration RIÊNG cho KTV này (chỉ segment của họ)
                let totalDuration = 0;
                for (const item of (b.BookingItems || [])) {
                    let segs: any[] = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }

                    const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode));
                    if (mySegs.length > 0) {
                        totalDuration += mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
                    } else if (item.technicianCodes && item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode)) {
                        totalDuration += 60; // Fallback
                    }
                }

                // 3. Tính base points theo ca làm
                const bookingDateStr = b.timeStart ? b.timeStart.slice(0, 10) : todayStr;
                let currentShift = 'SHIFT_1';
                const ktvShifts = (shiftsData || []).filter(s => s.employeeId === sId);
                for (const s of ktvShifts) {
                    const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                    if (effDate && effDate <= bookingDateStr) currentShift = s.shiftType;
                }

                let basePoints = s1Bonus;
                if (currentShift === 'SHIFT_2') basePoints = s2Bonus;
                else if (currentShift === 'SHIFT_3') basePoints = s3Bonus;

                if (totalDuration < 60) basePoints = basePoints / 2;
                const bonusPts = Math.floor(basePoints / totalUniqueKTVs);
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
