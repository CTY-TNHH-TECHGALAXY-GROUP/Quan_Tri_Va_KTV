import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/ktv/push-sync
 * Save push subscription to database using admin client (bypasses RLS)
 * Renamed to evade AdBlockers that block /notifications/subscribe
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { staffId, subscription, userAgent } = body;

        if (!staffId || !subscription) {
            return NextResponse.json(
                { success: false, error: 'staffId and subscription are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json(
                { success: false, error: 'Supabase admin not initialized' },
                { status: 500 }
            );
        }

        // Upsert subscription (replace if same staff + same endpoint)
        const { error } = await supabase
            .from('StaffPushSubscriptions')
            .upsert({
                staff_id: staffId,
                subscription: subscription,
                user_agent: userAgent || 'unknown',
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'staff_id,subscription'
            });

        if (error) {
            console.error('❌ [Push Sync API] Error saving subscription:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        // 🧹 DỌN DẸP SPAM
        // 🧹 DỌN DẸP SPAM: Xoá các user khác trên cùng 1 thiết bị (cùng endpoint)
        try {
            const targetEndpoint = subscription.endpoint;
            if (targetEndpoint) {
                const { error: cleanupErr, count } = await supabase
                    .from('StaffPushSubscriptions')
                    .delete({ count: 'exact' })
                    .neq('staff_id', staffId)
                    .eq('subscription->>endpoint', targetEndpoint);
                    
                if (!cleanupErr && count && count > 0) {
                    console.log(`🧹 [Push Sync API] Đã xoá ${count} subscription cũ do trùng thiết bị với ${staffId}.`);
                } else if (cleanupErr) {
                    console.error('⚠️ [Push Sync API] Cleanup old subscriptions query failed:', cleanupErr);
                }
            }
        } catch (cleanupErr) {
            console.error('⚠️ [Push Sync API] Cleanup old subscriptions failed:', cleanupErr);
        }

        console.log('✅ [Push Sync API] Push subscription saved for staff:', staffId);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('❌ [Push Sync API] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
