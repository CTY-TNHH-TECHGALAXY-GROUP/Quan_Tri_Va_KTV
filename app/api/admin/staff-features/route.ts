import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { StaffFeaturePatchSchema } from '@/lib/schemas/admin.schema';
import { SessionEpochService } from '@/lib/services/SessionEpochService';
import { STAFF_STATUS } from '@/lib/constants/staffStatus';
import { MANAGED_FLAG_KEYS } from '@/lib/featureFlags';

export const dynamic = 'force-dynamic';

/**
 * Mã nhân viên KHÔNG phải tài khoản app — chỗ giữ tên cho bảng điều phối khi
 * lễ tân gõ tay KTV ngoài (`EXT_...`, `EXT12`) hoặc gộp nhiều người vào một ô
 * (`C_...`). Không ai đăng nhập bằng mấy mã này nên bật/tắt tính năng cho chúng
 * là vô nghĩa, và 136 dòng rác sẽ chôn mất KTV thật.
 *
 * ⚠️ Trước đây bộ lọc là `ilike 'NH%'` — chặn đúng đám placeholder nhưng chặn
 * luôn cả KTV Loại D mã `T001`, `T016`, `T069`… nên 11/12 KTV loại D không hiện
 * trên bảng Tính năng: muốn tắt ví hay tắt nhận đơn ngoài giờ cho họ thì không
 * có dòng nào để bấm.
 */
const PLACEHOLDER_ID = /^(EXT|C_)/i;

function isAppAccount(id: string): boolean {
    return !PLACEHOLDER_ID.test(String(id || ''));
}

/**
 * `Staff.status` giờ chỉ còn ba giá trị, có CHECK constraint canh
 * (`lib/constants/staffStatus.ts`). `HỆ THỐNG` tự rơi ra khỏi bộ lọc này.
 *
 * ⚠️ Trước khi chuẩn hoá, cột này còn lẫn `active` / `working`, nên lọc cứng
 * `= 'ĐANG LÀM'` làm rơi mất `T007 (Bond)` — KTV loại D duy nhất mang status
 * `active`, không có dòng nào để bấm tắt/bật tính năng cho tài khoản đó.
 */

/**
 * Vai trò không cần cờ tính năng KTV: `dev` và `admin` đăng nhập vào phần quản
 * trị chứ không dùng app KTV, bật/tắt ví hay nhận đơn ngoài giờ cho họ là vô
 * nghĩa. Giữ `SUPPORT` — `NH099` mang vai trò này và vẫn là người dùng app.
 */
const NON_KTV_ROLES = new Set(['DEV', 'ADMIN']);

function forbidden(error: any) {
    const msg = error?.message || 'Lỗi không xác định';
    const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 0;
    return status ? NextResponse.json({ success: false, error: msg }, { status }) : null;
}

/**
 * GET /api/admin/staff-features
 * Returns all staff with their feature_flags for admin management.
 */
export async function GET() {
    try {
        await requirePermission('staff_features');

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Chỉ hiện người ĐĂNG NHẬP ĐƯỢC vào app: cờ tính năng quyết định họ thấy
        // gì trên máy họ, nên dòng nào không có tài khoản thì bật/tắt cũng vô nghĩa.
        // Tiêu chí này bền hơn đoán theo tiền tố mã (`NH…` / `T0…`).
        const [{ data: staffRaw, error }, { data: users }] = await Promise.all([
            supabase
                .from('Staff')
                .select('id, full_name, status, feature_flags, work_type')
                .eq('status', STAFF_STATUS.WORKING)
                .order('id', { ascending: true }),
            supabase.from('Users').select('code, role'),
        ]);

        const loginCodes = new Set(
            (users || [])
                .filter((u: any) => !NON_KTV_ROLES.has(String(u.role || '').toUpperCase()))
                .map((u: any) => String(u.code || '').toLowerCase())
                .filter(Boolean)
        );

        const staff = (staffRaw || []).filter((s: any) =>
            isAppAccount(s.id) && loginCodes.has(String(s.id).toLowerCase())
        );

        if (error) {
            console.error('❌ [Staff Features GET] Error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        // Fetch global configs for display
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['laundry_fee', 'ktv_sudden_off_penalty']);

        const configMap: Record<string, string> = {};
        (configs || []).forEach((c: any) => {
            configMap[c.key] = String(c.value).replace(/"/g, '');
        });

        return NextResponse.json({
            success: true,
            data: staff || [],
            configs: {
                laundry_fee: Number(configMap['laundry_fee'] || 20000),
                sudden_off_penalty: Number(configMap['ktv_sudden_off_penalty'] || 500000),
            }
        });
    } catch (err: any) {
        const denied = forbidden(err);
        if (denied) return denied;
        console.error('❌ [Staff Features GET] Unhandled:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/staff-features
 * Body: { staffId: string, flagKey: string, value: boolean }
 *   OR  { staffIds: string[], flagKey: string, value: boolean } (bulk)
 * Updates feature_flags for one or more staff members.
 */
export async function PATCH(request: Request) {
    try {
        await requirePermission('staff_features');

        const body = await request.json();

        // If updating work_type
        if (body.updateWorkType) {
            const { staffId, workType, newFlags } = body;
            const supabase = getSupabaseAdmin();
            if (!supabase) return NextResponse.json({ success: false }, { status: 500 });

            // Đổi loại KTV = đặt lại BỘ TÍNH NĂNG theo mặc định của loại mới.
            // Nhưng `feature_flags` còn là chỗ ở của trạng thái runtime do màn
            // khác ghi vào — `is_on_call`, `travel_time_mins`, `available_until`…
            // Ghi đè nguyên cụm bằng bộ mặc định là xoá sạch chúng: KTV đang bật
            // "nhận đơn ngoài giờ" bỗng tắt, quầy vẫn thấy họ rảnh vì chỗ khác
            // đọc cột `online_status`. Chỉ đặt lại đúng các khoá TÍNH NĂNG, khoá
            // lạ giữ nguyên.
            const { data: cur } = await supabase
                .from('Staff').select('feature_flags').eq('id', staffId).maybeSingle();
            const curFlags = (typeof (cur as any)?.feature_flags === 'string'
                ? JSON.parse((cur as any).feature_flags || '{}')
                : ((cur as any)?.feature_flags || {})) as Record<string, any>;

            const preserved: Record<string, any> = {};
            for (const [k, v] of Object.entries(curFlags)) {
                if (!MANAGED_FLAG_KEYS.includes(k)) preserved[k] = v;
            }
            const mergedFlags = { ...preserved, ...(newFlags || {}) };

            const { error } = await supabase
                .from('Staff')
                .update({ work_type: workType, feature_flags: mergedFlags })
                .eq('id', staffId);

            if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

            // Đổi loại KTV là đổi cả bộ cờ -> session cũ của người này hết hiệu lực.
            const loggedOut = await SessionEpochService.bumpStaff(supabase, [staffId]);
            return NextResponse.json({ success: true, loggedOut });
        }

        const parseResult = StaffFeaturePatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { staffId, staffIds, flagKey, value } = parseResult.data;

        const targetIds: string[] = staffIds || (staffId ? [staffId] : []);

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Update each staff member's feature_flags
        const errors: string[] = [];
        for (const id of targetIds) {
            // Fetch current flags
            const { data: current } = await supabase
                .from('Staff')
                .select('feature_flags')
                .eq('id', id)
                .maybeSingle();

            const currentFlags = (current?.feature_flags || {}) as Record<string, boolean>;
            const updatedFlags = { ...currentFlags, [flagKey]: value };

            const { error: updateError } = await supabase
                .from('Staff')
                .update({ feature_flags: updatedFlags })
                .eq('id', id);

            if (updateError) {
                errors.push(`${id}: ${updateError.message}`);
            }
        }

        if (errors.length > 0) {
            console.error('❌ [Staff Features PATCH] Errors:', errors);
            return NextResponse.json({ success: false, error: errors.join(', ') }, { status: 500 });
        }

        // Chỉ đá đúng những người vừa bị đổi cờ ra, không đụng ai khác.
        // Rỗng = cần gạt "Ép đăng xuất" đang tắt, không ai bị đá ra.
        const loggedOut = await SessionEpochService.bumpStaff(supabase, targetIds);

        return NextResponse.json({ success: true, updated: targetIds.length, loggedOut });
    } catch (err: any) {
        const denied = forbidden(err);
        if (denied) return denied;
        console.error('❌ [Staff Features PATCH] Unhandled:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
