import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Check authentication if needed (e.g. cron secret)
        const authHeader = request.headers.get('authorization');
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const now = new Date();
        const mins15Ago = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
        const mins10Ago = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

        // 1. Auto Approve Handover (Reception timeout 15 mins)
        // Tìm những item có handover_status = PENDING và cập nhật đã quá 15 phút
        const { data: pendingItems } = await supabase
            .from('BookingItems')
            .select('id, updated_at')
            .eq('handover_status', 'PENDING')
            .lte('updated_at', mins15Ago);

        if (pendingItems && pendingItems.length > 0) {
            const itemIds = pendingItems.map(i => i.id);
            await supabase
                .from('BookingItems')
                .update({ 
                    handover_status: 'APPROVED', 
                    handover_comment: 'Tự động duyệt do quá thời gian' 
                })
                .in('id', itemIds);
            
            console.log(`[Cron] Auto approved handover for ${itemIds.length} items`);
        }

        // 2. Auto PASS Customer Rating (Customer timeout 10 mins)
        // Tìm những item đang FEEDBACK, đã APPROVED bàn giao, và cập nhật đã quá 10 phút
        const { data: feedbackItems } = await supabase
            .from('BookingItems')
            .select('id, updated_at, bookingId')
            .eq('status', 'FEEDBACK')
            .eq('handover_status', 'APPROVED')
            .lte('updated_at', mins10Ago);

        if (feedbackItems && feedbackItems.length > 0) {
            const itemIds = feedbackItems.map(i => i.id);
            const uniqueBookingIds = Array.from(new Set(feedbackItems.map(i => i.bookingId).filter(Boolean)));
            
            // Đẩy status lên DONE
            await supabase
                .from('BookingItems')
                .update({ status: 'DONE' })
                .in('id', itemIds);
            
            console.log(`[Cron] Auto set DONE for ${itemIds.length} items`);

            // Recompute booking statuses
            const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
            for (const bId of uniqueBookingIds) {
                const { data: bItems } = await supabase.from('BookingItems').select('status, serviceId, Services!BookingItems_serviceId_fkey(is_utility)').eq('bookingId', bId);
                if (bItems && bItems.length > 0) {
                    const validItems = bItems.filter((i: any) => i.Services?.is_utility !== true && String(i.serviceId).toUpperCase() !== 'NHS0900');
                    const finalItems = validItems.length > 0 ? validItems : bItems;
                    const newBStatus = recomputeBookingStatus(finalItems.map((i: any) => i.status));
                    await supabase.from('Bookings').update({ status: newBStatus }).eq('id', bId);
                }
            }

            // Gửi push notification cho KTV báo có tiền tua
            // (Thực tế tiền tua sẽ được view_wallet timeline tính dựa trên status DONE)
            // Lấy danh sách KTV codes
            const { data: itemKTVs } = await supabase
                .from('BookingItems')
                .select('id, technicianCodes')
                .in('id', itemIds);
                
            if (itemKTVs) {
                const uniqueKtvCodes = new Set<string>();
                itemKTVs.forEach(item => {
                    if (Array.isArray(item.technicianCodes)) {
                        item.technicianCodes.forEach((tc: string) => uniqueKtvCodes.add(tc));
                    }
                });

                if (uniqueKtvCodes.size > 0) {
                    for (const ktvId of Array.from(uniqueKtvCodes)) {
                        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://nganha.vercel.app'}/api/notifications/push`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userIds: [ktvId],
                                title: 'Nhận Tiền Tua',
                                body: 'Bạn đã nhận được tiền tua, hãy kiểm tra ví!',
                                data: { type: 'REWARD_APPROVED' }
                            })
                        }).catch(err => console.error("Push notify error", err));
                    }
                }
            }
        }

        return NextResponse.json({ success: true, pendingApproved: pendingItems?.length || 0, feedbackDone: feedbackItems?.length || 0 });

    } catch (error: any) {
        console.error('❌ [KTV Auto Approve Cron] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
