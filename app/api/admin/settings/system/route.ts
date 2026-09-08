import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { SystemSettingsSchema } from '@/lib/schemas/admin.schema';
import { SessionEpochService, scopeForConfigKey, EpochScope } from '@/lib/services/SessionEpochService';

// Các config mặc định nếu chưa có trong DB
const DEFAULT_CONFIGS = {
    // KTV Loại A (Mặc định)
    ktv_bonus_rate_TYPE_A: 1000,
    ktv_shift_1_bonus_TYPE_A: 20,
    ktv_shift_2_bonus_TYPE_A: 20,
    ktv_shift_3_bonus_TYPE_A: 30,
    ktv_deposit_amount_TYPE_A: 1000000,
    ktv_sudden_off_penalty_TYPE_A: 50000,
    ktv_instant_reward_enabled_TYPE_A: true,
    
    // KTV Loại B
    ktv_bonus_rate_TYPE_B: 1000,
    ktv_shift_1_bonus_TYPE_B: 20,
    ktv_shift_2_bonus_TYPE_B: 20,
    ktv_shift_3_bonus_TYPE_B: 20,
    ktv_deposit_amount_TYPE_B: 0,
    ktv_sudden_off_penalty_TYPE_B: 0,
    ktv_instant_reward_enabled_TYPE_B: true,

    // KTV Loại C
    ktv_bonus_rate_TYPE_C: 1000,
    ktv_shift_1_bonus_TYPE_C: 20,
    ktv_shift_2_bonus_TYPE_C: 20,
    ktv_shift_3_bonus_TYPE_C: 20,
    ktv_deposit_amount_TYPE_C: 0,
    ktv_sudden_off_penalty_TYPE_C: 0,
    ktv_instant_reward_enabled_TYPE_C: true,

    // KTV Discipline
    ktv_discipline_demotion_threshold: 80,
    ktv_continuous_work_gap_mins: 30,
    ktv_continuous_work_exempt_hours: 4,

    // Bàn giao phòng (áp cho mọi loại KTV)
    // Số đơn được NỢ bàn giao — tính chung mọi lúc, không reset theo ngày:
    // nợ đủ số này là chặn bấm "Bỏ qua" cho tới khi trả bớt.
    max_handover_skip: 2,
    // Quầy có ngần này phút để duyệt ảnh bàn giao, quá hạn thì cron tự duyệt.
    reception_auto_approve_minutes: 15,
    // Số lần quầy được trả lại (bắt dọn lại) trên cùng một đơn.
    max_handover_reject: 2,
    ktv_discipline_rules: [
        { code: 'ORDER_REJECT', name: 'Từ chối đơn', points: 10 },
        { code: 'LATE', name: 'Đi làm trễ', points: 5 },
        { code: 'BAD_REVIEW', name: 'Khách phàn nàn', points: 15 },
        { code: 'BAD_HANDOVER', name: 'Lỗi bàn giao phòng', points: 5 }
    ],

    // KTV Loai D
    // BAT = KTV loai D tu xem duoc bang xep hang gio cua ca nhom tren app cua ho.
    ktv_type_d_hours_ranking_enabled: true,
    // Cong tac TONG cua ky luat Loai D: tru gio vang/tre/bo ca/tu choi tua VA
    // tu khoa tai khoan. TAT = khong tru, khong khoa, khong chan cua.
    ktv_type_d_discipline_enabled: false,

    // Global
    enable_web_advance_booking_email: false,
    enable_maintenance_fee: false,
    maintenance_fee_amount: 50000,
    maintenance_fee_deduct_deposit: false,
    
    // Legacy (Fallback cho hệ thống cũ chưa migrate)
    ktv_bonus_rate: 1000,
    ktv_shift_1_bonus: 20,
    ktv_shift_2_bonus: 20,
    ktv_shift_3_bonus: 30,
    ktv_deposit_amount: 1000000,
    ktv_sudden_off_penalty: 50000,
    ktv_instant_reward_enabled: true
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
        // Đây là chỗ gạt CÔNG TẮC CẢ LOẠI — tắt ví tua TYPE_D ở đây là cả nhóm
        // mất ví. Không có lớp kiểm quyền thì bất kỳ ai gọi được API cũng đổi
        // được cấu hình vận hành của toàn hệ thống.
        await requirePermission('system_settings');

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

        // Đổi CÔNG TẮC tính năng thì phải đá người dùng ra, không thì máy nào
        // không đăng xuất vẫn giữ menu/quyền cũ trong storage. Khoá có đuôi
        // `_TYPE_x` chỉ đá loại đó; khoá chung đá tất cả. Đơn giá / số tiền
        // không nằm trong session nên bỏ qua.
        const scopes = Object.keys(validBody)
            .map(scopeForConfigKey)
            .filter((s): s is EpochScope => s !== null);
        const loggedOutScopes = await SessionEpochService.bumpScopes(supabase, scopes);

        return NextResponse.json({ success: true, loggedOutScopes });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        if (msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED') {
            return NextResponse.json({ success: false, error: msg }, { status: 403 });
        }
        if (msg === 'Unauthorized') {
            return NextResponse.json({ success: false, error: msg }, { status: 401 });
        }
        console.error('Lỗi lưu SystemConfigs:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
