import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';

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
 * Những khoá mà route CÔNG KHAI này được phép ghi, kèm quyền cần có.
 *
 * ⚠️ Đây là route ngoài `/api/admin`, dựng ra chỉ để bảng điều phối gán người
 * châm nước. Nhưng nó ghi thẳng vào `SystemConfigs` — cùng cái bảng chứa công
 * tắc ví, khung giá tua, mức phí bảo trì. Không có danh sách trắng thì một lời
 * gọi `{key: 'ktv_wallet_tua_enabled_TYPE_D', value: false}` từ đây là tắt ví
 * cả loại D, đi vòng qua đúng lớp `requirePermission('system_settings')` mà
 * `/api/admin/settings/system` đang canh.
 *
 * Thêm khoá vào đây là mở thêm cửa — cân nhắc dùng route admin trước.
 */
const WRITABLE_KEYS: Record<string, string> = {
    // Bảng điều phối của quầy gán KTV châm nước trong ngày.
    //
    // Dùng `dispatch_board` chứ KHÔNG dùng `turn_tracking` cho dù cái tên kia
    // nghe sát nghĩa hơn: `turn_tracking` không nằm trong `MODULES`
    // (`lib/constants.ts`), mà `getFallbackPermissions` dựng quyền của admin/dev
    // bằng đúng `MODULES.map(m => m.id)`. Chọn nó là admin bị chặn khỏi thao tác
    // của chính quầy. `dispatch_board` có trong MODULES, và các route quầy khác
    // (`reception/guest-arrival`, `ktv/finish-early-paused`) cũng đang dùng nó.
    daily_water_refiller: 'dispatch_board',
};

/**
 * POST /api/system/config
 * Update a system config value.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { key, value } = body;

        if (!key) return NextResponse.json({ success: false, error: 'Missing key' }, { status: 400 });

        const requiredPermission = WRITABLE_KEYS[key];
        if (!requiredPermission) {
            // Đừng nói khoá đó có tồn tại hay không — chỉ nói route này không ghi nó.
            return NextResponse.json(
                { success: false, error: `Khoá '${key}' không ghi được qua route này. Dùng /api/admin/settings/system.` },
                { status: 403 }
            );
        }

        await requirePermission(requiredPermission);

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Fix constraint not-null của bảng SystemConfigs
        const safeValue = value === null ? "" : value;

        const { error } = await supabase
            .from('SystemConfigs')
            .upsert({ key, value: safeValue }, { onConflict: 'key' });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        const msg = error?.message || '';
        if (msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED') {
            return NextResponse.json({ success: false, error: msg }, { status: 403 });
        }
        if (msg === 'Unauthorized') {
            return NextResponse.json({ success: false, error: msg }, { status: 401 });
        }
        console.error('❌ [System Config POST] Error:', error);
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
