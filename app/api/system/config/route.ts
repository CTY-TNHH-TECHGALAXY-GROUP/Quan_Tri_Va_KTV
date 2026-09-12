import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/system/config
 * Returns system config values (web_booking_url, etc.) from SystemConfigs table.
 */
export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data: configs, error } = await supabase
            .from('SystemConfigs')
            .select('key, value');

        if (error || !configs) {
            return NextResponse.json({ success: true, data: {} });
        }

        // Convert array to key-value object
        const result: Record<string, string> = {};
        configs.forEach((c: any) => {
            result[c.key] = c.value;
        });

        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        console.error('❌ [System Config] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/system/config
 * Update a system config value.
 */
export async function POST(req: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const body = await req.json();
        const { key, value } = body;

        if (!key) return NextResponse.json({ success: false, error: 'Missing key' }, { status: 400 });

        // Fix constraint not-null của bảng SystemConfigs
        const safeValue = value === null ? "" : value;

        const { error } = await supabase
            .from('SystemConfigs')
            .upsert({ key, value: safeValue }, { onConflict: 'key' });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('❌ [System Config POST] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
