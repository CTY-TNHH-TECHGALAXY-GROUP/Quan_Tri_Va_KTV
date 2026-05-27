import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/admin/notification-rules
 * Fetch notification rules config from SystemConfigs
 */
export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'notification_rules')
            .maybeSingle();

        if (error) {
            console.error('❌ [NotifRules GET] Error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: data?.value || {} });
    } catch (err: any) {
        console.error('❌ [NotifRules GET] Unhandled:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/notification-rules
 * Update notification rules config
 * Body: { rules: Record<string, NotifRule> }
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { rules } = body;

        if (!rules || typeof rules !== 'object') {
            return NextResponse.json({ success: false, error: 'Missing or invalid rules object' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { error } = await supabase
            .from('SystemConfigs')
            .update({ value: rules })
            .eq('key', 'notification_rules');

        if (error) {
            console.error('❌ [NotifRules PATCH] Error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        console.log('✅ [NotifRules] Updated notification rules config');
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('❌ [NotifRules PATCH] Unhandled:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
