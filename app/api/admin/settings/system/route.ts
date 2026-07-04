import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SystemSettingsSchema } from '@/lib/schemas/admin.schema';

// Các config mặc định nếu chưa có trong DB
const DEFAULT_CONFIGS = {
    ktv_bonus_rate: 1000,
    ktv_shift_1_bonus: 20,
    ktv_shift_2_bonus: 20,
    ktv_shift_3_bonus: 40,
    ktv_deposit_amount: 3000000,
    ktv_sudden_off_penalty: 50000,
    enable_web_advance_booking_email: false
};

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const { data, error } = await supabase.from('SystemConfigs').select('*');
        if (error) {
            // Nếu bảng chưa được tạo, có thể ignore hoặc log
            console.error('Lỗi lấy SystemConfigs:', error.message);
            return NextResponse.json({ data: DEFAULT_CONFIGS });
        }

        // Merge với default configs
        const result: Record<string, any> = { ...DEFAULT_CONFIGS };
        data?.forEach(row => {
            result[row.key] = row.value;
        });

        return NextResponse.json({ data: result });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const body = await request.json();
        const parseResult = SystemSettingsSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const validBody = parseResult.data;
        
        // Upsert từng key
        const promises = Object.keys(validBody).map(key => {
            return supabase.from('SystemConfigs').upsert({
                key: key,
                value: validBody[key],
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
        });

        await Promise.all(promises);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Lỗi lưu SystemConfigs:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
