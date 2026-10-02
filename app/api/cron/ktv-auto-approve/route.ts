import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const unauthorized = requireCronAuth(request);
    if (unauthorized) return unauthorized;
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const now = new Date();

        // Hạn duyệt lấy từ cài đặt (Cài đặt > Tính năng > Bàn giao phòng), không
        // để số cứng ở đây — HandoverService.autoApproveExpired đã đọc khoá này,
        // hai nơi cùng một luật thì phải cùng một nguồn.
        const { data: apCfg } = await supabase
            .from('SystemConfigs').select('value').eq('key', 'reception_auto_approve_minutes').maybeSingle();
        const approveMins = Number.parseInt(String((apCfg as any)?.value ?? '15'), 10) || 15;

        const mins15Ago = new Date(now.getTime() - approveMins * 60 * 1000).toISOString();
        const mins10Ago = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

        // 1. Auto Approve Handover (Reception timeout 15 mins)
        // Tìm những item có handover_status = PENDING và cập nhật đã quá 15 phút
        // Đếm hạn từ MỐC NỘP. `updated_at` không tồn tại trên bảng này nên truy
        // vấn cũ lỗi âm thầm; và lọc theo `handover_status` không thôi là sai vì
        // cột đó mặc định 'PENDING' cho cả item chưa từng bàn giao.
        const { data: pendingItems, error: pendingErr } = await supabase
            .from('BookingItems')
            .select('id')
            .eq('handover_status', 'PENDING')
            .not('handover_submitted_at', 'is', null)
            .lte('handover_submitted_at', mins15Ago);

        if (pendingErr) console.error('[Cron] Loi tim don cho duyet:', pendingErr);

        if (pendingItems && pendingItems.length > 0) {
            const itemIds = pendingItems.map(i => i.id);
            await supabase
                .from('BookingItems')
                .update({ 
                    handover_status: 'APPROVED', 
                    // Đã duyệt thì không thể còn là "bỏ qua" — DB có CHECK chặn
                    // cặp APPROVED + skipped=true.
                    handover_skipped: false,
                    handover_comment: 'Tự động duyệt do quá thời gian' 
                })
                .in('id', itemIds);
            
            console.log(`[Cron] Auto approved handover for ${itemIds.length} items`);
        }

        // 2. Auto PASS Customer Rating (Customer timeout 10 mins)
        // Tìm những item đang FEEDBACK, đã APPROVED bàn giao, và cập nhật đã quá 10 phút
        const { data: feedbackItems } = await supabase
            .from('BookingItems')
            .select('id, bookingId')
            .eq('status', 'FEEDBACK')
            .eq('handover_status', 'APPROVED')
            // "BookingItems" khong co cot `updated_at` — truy van cu loi va bi nuot,
            // nen auto-PASS danh gia khach chua bao gio chay. Dem han tu `timeEnd`
            // (luc ket thuc dich vu), day cung la moc khach bat dau danh gia duoc.
            .not('timeEnd', 'is', null)
            .lte('timeEnd', mins10Ago);

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
