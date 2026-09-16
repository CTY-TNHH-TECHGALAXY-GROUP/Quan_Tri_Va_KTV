import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { drainRecomputeQueue } from '@/lib/services/KtvDLedgerWriter';

export const dynamic = 'force-dynamic';

/**
 * Worker rút `KTVDRecomputeQueue` → tính lại `KTVDTurnLedger`.
 *
 * Trigger trên BookingItems / BookingGuests / Bookings đẩy id vào hàng đợi;
 * worker này rút ra và gọi `recomputeTurnRows()`. Nhờ vậy sổ cái bắt được
 * MỌI đường ghi, kể cả đường viết thêm sau này.
 *
 * Chỉ ghi vào KTVDTurnLedger. Không đụng Bookings, BookingItems, hay bất kỳ
 * bảng nào của luồng vận hành.
 *
 * `?batch=` để chỉnh số item xử lý mỗi lượt (mặc định 200).
 */
async function run(batchSize: number) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });
    }

    const started = Date.now();
    const result = await drainRecomputeQueue(supabase, batchSize);

    if (result.queueTaken > 0) {
        console.log(
            `[KTVD Recompute] lấy ${result.queueTaken} · ghi ${result.rowsWritten} · VOID ${result.rowsVoided}` +
            ` · lỗi ${result.failed} · còn ${result.queueRemaining} · ${Date.now() - started}ms`
        );
    }

    return NextResponse.json({ success: true, ...result, ms: Date.now() - started });
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }
    try {
        const batch = Number(new URL(request.url).searchParams.get('batch')) || 200;
        return await run(Math.min(Math.max(batch, 1), 1000));
    } catch (err: any) {
        console.error('Exception in ktvd-recompute:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export const POST = GET;
