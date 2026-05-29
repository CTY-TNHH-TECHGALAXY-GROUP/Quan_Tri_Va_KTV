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

        // 1. Fetch Earned
        const { data: earns, error: earnErr } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_bonus, staff_id')
            .eq('staff_id', techCode)
            .gt('total_bonus', 0)
            .order('date', { ascending: false });

        if (earnErr) throw earnErr;

        // 2. Fetch Adjustments (GIFT/PENALTY)
        const { data: adjs, error: adjErr } = await supabase
            .from('WalletAdjustments')
            .select('created_at, amount, type, reason')
            .eq('staff_id', techCode)
            .eq('wallet_type', 'BONUS');

        if (adjErr) throw adjErr;

        // 3. Fetch Withdrawals (REDEEM)
        const { data: wths, error: wthErr } = await supabase
            .from('KTVWithdrawals')
            .select('request_date, amount, status')
            .eq('staff_id', techCode)
            .eq('wallet_type', 'BONUS');

        if (wthErr) throw wthErr;

        // 3.5 Fetch Realtime Bookings for today
        const nowVn = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
        const todayStr = new Date(nowVn.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const { data: bookings } = await supabase
            .from('Bookings')
            .select(`
                id, timeStart, timeEnd, status, technicianCode, rating, billCode,
                BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, itemRating )
            `)
            .gte('timeStart', `${todayStr}T00:00:00+07:00`)
            .in('status', ['DONE', 'FEEDBACK', 'CLEANING']);

        // 4. Merge and Format
        const timeline: any[] = [];

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
                    
                    if (bonusPts > 0) {
                        timeline.push({
                            id: `rt-earn-${b.id}`,
                            date: b.timeStart || todayStr,
                            points: bonusPts,
                            type: 'EARN',
                            desc: `Thưởng đánh giá (${bookingRating}★) - Đơn ${b.billCode || b.id.substring(0, 6)}`
                        });
                    }
                }
            }
        });

        (earns || []).forEach(e => {
            timeline.push({
                id: `earn-${e.date}`,
                date: e.date,
                points: Number(e.total_bonus),
                type: 'EARN',
                desc: 'Điểm làm dịch vụ'
            });
        });

        (adjs || []).forEach(a => {
            const amt = Number(a.amount);
            const isGift = a.type === 'GIFT' || amt > 0;
            timeline.push({
                id: `adj-${a.created_at}`,
                date: a.created_at,
                points: Math.abs(amt),
                type: isGift ? 'GIFT' : 'PENALTY',
                desc: a.reason || (isGift ? 'Thưởng điểm' : 'Phạt điểm')
            });
        });

        (wths || []).forEach(w => {
            timeline.push({
                id: `wth-${w.request_date}`,
                date: w.request_date,
                points: Number(w.amount),
                type: 'REDEEM',
                desc: `Rút điểm (${w.status})`,
                status: w.status
            });
        });

        // Sort by Date Descending
        timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return NextResponse.json({
            success: true,
            data: timeline
        });
    } catch (error: any) {
        console.error('Lỗi lấy lịch sử bonus:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
