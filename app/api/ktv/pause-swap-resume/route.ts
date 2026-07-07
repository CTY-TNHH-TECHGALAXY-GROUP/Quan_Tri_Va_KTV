import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BookingItemPauseService } from '@/lib/services/BookingItemPauseService';
import { syncTurnsForDate } from '@/lib/turn-sync';
import { z } from 'zod';

const pauseSwapSchema = z.object({
    action: z.enum(['PAUSE', 'RESUME', 'SWAP']),
    bookingItemId: z.string().min(1, 'Thiếu bookingItemId'),
    oldKtvId: z.string().optional(),
    newKtvId: z.string().optional(),
    extraTimeMins: z.number().nonnegative().optional().default(0),
    businessDate: z.string().optional(),
    keepTurnForOldKtv: z.boolean().optional(),
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

        const { action, bookingItemId, oldKtvId, newKtvId, extraTimeMins, businessDate, keepTurnForOldKtv } = parsedData.data;

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
                    keepTurnForOldKtv
                );
                // Sau khi swap thành công, tự động resume luôn theo luồng
                if (newKtvId) {
                    await BookingItemPauseService.resumeItem(supabase, bookingItemId);
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
