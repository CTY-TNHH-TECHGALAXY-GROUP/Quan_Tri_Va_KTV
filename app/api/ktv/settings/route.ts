import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * API Lấy cấu hình hệ thống cho KTV
 * GET /api/ktv/settings
 */
export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Lấy toàn bộ cấu hình từ bảng SystemConfigs
        const { data: configs, error } = await supabase
            .from('SystemConfigs')
            .select('*');

        // Fallback nếu bảng chưa tồn tại hoặc không có dữ liệu
        const defaultSettings = {
            auto_finish_on_timer_end: true,
            push_notifications_enabled: true,
            allow_early_checkout: true,
            spa_day_cutoff_hours: 6,
            min_photo_brightness: 40
        };

        if (error || !configs || configs.length === 0) {
            console.warn('⚠️ [API KTV Settings] SystemConfigs table not found or empty, using defaults');
            return NextResponse.json({ success: true, data: defaultSettings, isFallback: true });
        }

        // Chuyển đổi array sang object key-value
        const settings: any = {};
        configs.forEach((c: any) => {
            settings[c.key] = c.value;
        });

        return NextResponse.json({ success: true, data: { ...defaultSettings, ...settings } });
    } catch (error: any) {
        console.error('API Error (GET /api/ktv/settings):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
