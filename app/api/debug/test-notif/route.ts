import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';

/**
 * Debug endpoint: Test StaffNotifications insert
 * GET /api/debug/test-notif
 */
export async function GET() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ error: 'no supabase' }, { status: 500 });

    // 1. Check existing columns by doing a minimal select
    const { data: cols, error: colErr } = await supabase
        .from('StaffNotifications')
        .select('*')
        .limit(1);
    
    // 2. Try createNotification
    let insertErr = null;
    let inserted = null;
    try {
        inserted = await createNotification({
            type: 'NEW_ORDER',
            message: '🎉 [TEST] Có đơn đặt phòng mới ảo từ Web Booking! Vui lòng vào check!',
        });
    } catch (e: any) {
        insertErr = e;
    }

    return NextResponse.json({
        selectResult: cols,
        selectError: colErr?.message ?? null,
        insertResult: inserted,
        insertError: insertErr?.message ?? null,
        insertCode: insertErr?.code ?? null,
    });
}
