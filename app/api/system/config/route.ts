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
