import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvPushUnsubscribeSchema } from '@/lib/schemas/ktv.schema';

/**
 * POST /api/ktv/push-unsubscribe
 * Xóa push subscription khỏi database khi user đăng xuất
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const parseResult = KtvPushUnsubscribeSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const { staffId, endpoint } = parseResult.data;

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json(
                { success: false, error: 'Supabase admin not initialized' },
                { status: 500 }
            );
        }

        // Xóa subscription có trùng endpoint và staffId
        const { error, count } = await supabase
            .from('StaffPushSubscriptions')
            .delete({ count: 'exact' })
            .eq('staff_id', staffId)
            .eq('subscription->>endpoint', endpoint);

        if (error) {
            console.error('❌ [Push Unsubscribe API] Error deleting subscription:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        console.log(`✅ [Push Unsubscribe API] Deleted ${count || 0} subscriptions for staff:`, staffId);
        return NextResponse.json({ success: true, count });
    } catch (error: any) {
        console.error('❌ [Push Unsubscribe API] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
