import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { cleanupExpiredPhotos } from '@/lib/services/PhotoCleanupService';
import { requireCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Dọn ảnh hết hạn trong bucket `attendance` — xem lib/services/PhotoCleanupService.ts.
 * Ảnh chấm công giữ 30 ngày; ảnh của đơn DONE giữ 3 ngày; bằng chứng kỷ luật không xoá.
 *
 * `?dry=1` chỉ đếm và trả mẫu tên file, không xoá gì.
 */
export async function GET(request: Request) {
    const unauthorized = requireCronAuth(request);
    if (unauthorized) return unauthorized;

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });
    }

    try {
        const dryRun = new URL(request.url).searchParams.get('dry') === '1';
        const started = Date.now();
        const result = await cleanupExpiredPhotos(supabase, { dryRun });
        console.log(
            `[Photo Cleanup]${dryRun ? ' DRY' : ''} chấm công ${result.attendance.candidates} (${result.attendance.mb}MB)` +
            ` · ảnh đơn ${result.booking.candidates} (${result.booking.mb}MB) · đã xoá ${result.deleted}` +
            ` · còn ${result.remaining} · ${Date.now() - started}ms`
        );
        return NextResponse.json({ success: true, ...result, ms: Date.now() - started });
    } catch (err: any) {
        console.error('Exception in cleanup-photos:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
