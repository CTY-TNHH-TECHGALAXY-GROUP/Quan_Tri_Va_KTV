import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const techCode = searchParams.get('techCode');

    if (!techCode) {
        return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
    }

    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'Lỗi máy chủ' }, { status: 500 });

        // 1. Fetch Earned Bonus
        const { data: earns, error: earnErr } = await supabase
            .from('KTVDailyLedger')
            .select('total_bonus')
            .eq('staff_id', techCode)
            .gt('total_bonus', 0);

        if (earnErr) throw earnErr;

        // 2. Fetch Deducted Bonus
        const { data: adjustments, error: adjErr } = await supabase
            .from('WalletAdjustments')
            .select('amount, type')
            .eq('staff_id', techCode)
            .eq('wallet_type', 'BONUS');

        if (adjErr) throw adjErr;

        // 3. Fetch Redeemed Bonus
        const { data: withdrawals, error: wthErr } = await supabase
            .from('KTVWithdrawals')
            .select('amount')
            .eq('staff_id', techCode)
            .eq('wallet_type', 'BONUS')
            .in('status', ['PENDING', 'APPROVED']);

        if (wthErr) throw wthErr;

        // 3.5 Fetch Realtime Bookings for today
        const nowVn = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
        const todayStr = new Date(nowVn.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const { data: bookings } = await supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, itemRating )
            `)
            .gte('timeStart', `${todayStr}T00:00:00+07:00`)
            .in('status', ['DONE', 'FEEDBACK', 'CLEANING']);

        let rt_bonus = 0;
        (bookings || []).forEach(b => {
            const bRating = Number(b.rating) || 0;
            const maxItemRating = Math.max(...(b.BookingItems || []).map((i: any) => Number(i.itemRating) || 0), 0);
            const bookingRating = Math.max(bRating, maxItemRating);

            if (bookingRating >= 4) {
                let isInvovled = false;
                const allKtvCodes = new Set<string>();
                for (const item of (b.BookingItems || [])) {
                    if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                        item.technicianCodes.forEach((tc: string) => {
                            allKtvCodes.add(tc.toLowerCase());
                            if (tc.toLowerCase() === techCode.toLowerCase()) isInvovled = true;
                        });
                    }
                }
                
                if (isInvovled) {
                    let totalDuration = 0;
                    for (const item of (b.BookingItems || [])) {
                        let segs: any[] = [];
                        try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
                        if (segs.length > 0) totalDuration += segs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
                        else totalDuration += 60;
                    }

                    let adjustedBasePoints = 20;
                    if (totalDuration < 60) adjustedBasePoints = 10;
                    const bonusPts = Math.floor(adjustedBasePoints / (allKtvCodes.size || 1));
                    rt_bonus += bonusPts;
                }
            }
        });

        // 4. Calculate Balance
        let totalPoints = (earns || []).reduce((sum, record) => sum + Number(record.total_bonus || 0), 0) + rt_bonus;
        
        (adjustments || []).forEach(tx => {
            const amt = Number(tx.amount || 0);
            if (tx.type === 'GIFT' || amt > 0) totalPoints += Math.abs(amt);
            else totalPoints -= Math.abs(amt);
        });

        const totalRedeemed = (withdrawals || []).reduce((sum, record) => sum + Number(record.amount || 0), 0);
        
        totalPoints -= totalRedeemed;
        if (totalPoints < 0) totalPoints = 0;
        
        // Trả về kèm số điểm tương đương VNĐ
        return NextResponse.json({
            success: true,
            data: {
                points: totalPoints,
                vnd_value: totalPoints * 1000
            }
        });
    } catch (error: any) {
        console.error('Lỗi tính điểm bonus:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
