import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BookingItemPauseService } from '@/lib/services/BookingItemPauseService';
import { syncTurnsForDate } from '@/lib/turn-sync';
import { z } from 'zod';
import { isTwoSlotSequential } from '@/lib/dispatch-status';
import { parseKtvSegments, isLiveKtvSegment } from '@/lib/ktvUtils';
import { performSequentialLifecycle } from '@/lib/services/SequentialLifecycleService';
import { requirePermission } from '@/lib/auth-server';

const pauseSwapSchema = z.object({
    action: z.enum(['PAUSE', 'RESUME', 'SWAP']),
    bookingItemId: z.string().min(1, 'Thiếu bookingItemId'),
    oldKtvId: z.string().optional(),
    employeeId: z.string().optional(),
    newKtvId: z.string().optional(),
    extraTimeMins: z.number().nonnegative().optional().default(0),
    businessDate: z.string().optional(),
    keepTurnForOldKtv: z.boolean().optional(),
    /** Số phút quầy gán tay cho KTV mới; 0 = dùng phần còn lại + giờ bù. */
    assignedMins: z.number().nonnegative().optional().default(0),
    /** Lý do đổi người — hiện ở Lịch sử của KTV bị đổi. */
    swapReason: z.string().max(500).optional().default(''),
}).refine(data => {
    if (data.action === 'SWAP') {
        return !!data.oldKtvId && !!data.businessDate;
    }
    return true;
}, {
    message: 'Thiếu tham số SWAP (oldKtvId, businessDate)',
});

export async function POST(req: Request) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        const body = await req.json();
        
        // Zod validation
        const parsedData = pauseSwapSchema.safeParse(body);
        if (!parsedData.success) {
            return NextResponse.json({ 
                success: false, 
                error: parsedData.error.issues?.[0]?.message || parsedData.error.message || 'Dữ liệu không hợp lệ' 
            }, { status: 400 });
        }

        const { action, bookingItemId, oldKtvId, newKtvId, extraTimeMins, businessDate, keepTurnForOldKtv, assignedMins, swapReason } = parsedData.data;
        const { data: scopedItem, error: scopedError } = await supabase.from('BookingItems').select('id, options, segments').eq('id', bookingItemId).single();
        if (scopedError) throw scopedError;
        if (isTwoSlotSequential(scopedItem?.options)) {
            if (action !== 'PAUSE') await requirePermission('dispatch_board');
            const slot = action === 'SWAP' ? Number(parseKtvSegments(scopedItem.segments).find(seg => isLiveKtvSegment(seg, oldKtvId) && !seg.actualEndTime)?.sequenceSlot) : undefined;
            const data = await performSequentialLifecycle(supabase, bookingItemId, {
                action, employeeId: parsedData.data.employeeId, targetSlots: slot ? [slot] : undefined,
                newKtvId, assignedMins, extraTimeMins, reason: swapReason,
            });
            return NextResponse.json({ success: true, data });
        }

        let result;
        switch (action) {
            case 'PAUSE':
                result = await BookingItemPauseService.pauseItem(supabase, bookingItemId);
                break;
            case 'RESUME':
                result = await BookingItemPauseService.resumeItem(supabase, bookingItemId);
                break;
            case 'SWAP':
                result = await BookingItemPauseService.swapKtvOnPausedItem(
                    supabase,
                    bookingItemId,
                    oldKtvId!,
                    newKtvId!,
                    extraTimeMins,
                    businessDate!,
                    keepTurnForOldKtv,
                    assignedMins,
                    swapReason
                );
                // Sau khi swap thành công, tự động resume luôn theo luồng.
                // Ghi nhật ký thành "Gửi người mới <mã>" chứ không phải "Tiếp tục":
                // quầy không hề bấm Tiếp tục, và dòng cuối phải cho biết đơn đã
                // sang tay ai.
                if (newKtvId) {
                    await BookingItemPauseService.resumeItem(supabase, bookingItemId, {
                        action: 'SWAP_SEND', note: newKtvId,
                    });
                }
                
                // ĐỒNG BỘ LẠI LƯỢT TUA
                await syncTurnsForDate(businessDate!);
                break;
        }

        return NextResponse.json({ success: true, data: result });
    } catch (err: any) {
        console.error('Error in pause-swap-resume API:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
