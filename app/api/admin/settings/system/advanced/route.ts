import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { AdvancedSettingPostSchema, AdvancedSettingPatchSchema } from '@/lib/schemas/admin.schema';
import { SessionEpochService, scopeForConfigKey, EpochScope } from '@/lib/services/SessionEpochService';

/**
 * Tab "Nâng cao" — sửa THẲNG từng dòng của bảng `SystemConfigs`.
 *
 * Cùng một cái bảng mà trang Cài đặt hệ thống đang gạt công tắc, nhưng ở đây
 * không có form nào ràng buộc: ghi được khoá bất kỳ, giá trị bất kỳ, và xoá
 * được cả dòng. Nói cách khác đây là đường vòng vào đúng chỗ mà
 * `../route.ts` đã canh bằng `requirePermission('system_settings')` — thiếu
 * lớp canh ở đây thì lớp canh bên kia vô nghĩa.
 *
 * ⚠️ `requirePermission` hiện vẫn còn nhánh "Compatibility Phase": không có
 * phiên JWT thì nó cho qua kèm cảnh báo. Lớp này vì vậy chặn được người ĐÃ
 * đăng nhập mà không đủ quyền, chứ chưa chặn được khách vãng lai — chừng nào
 * `middleware.ts` còn comment dòng trả 401.
 */

/** Ánh xạ lỗi phân quyền sang mã HTTP. `null` = không phải lỗi phân quyền. */
function authFailure(error: any) {
    const msg = error?.message || '';
    if (msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED') {
        return NextResponse.json({ success: false, error: msg }, { status: 403 });
    }
    if (msg === 'Unauthorized') {
        return NextResponse.json({ success: false, error: msg }, { status: 401 });
    }
    return null;
}

/**
 * Sửa khoá dạng công tắc ở đây cũng phải đá người dùng ra như khi sửa từ trang
 * Cài đặt hệ thống — nếu không, cùng một thay đổi mà đi hai đường lại cho hai
 * kết quả khác nhau: máy chưa đăng xuất vẫn giữ menu và quyền cũ trong storage.
 */
async function bumpSessionsFor(supabase: any, keys: (string | undefined)[]) {
    const scopes = keys
        .filter((k): k is string => !!k)
        .map(scopeForConfigKey)
        .filter((s): s is EpochScope => s !== null);
    if (scopes.length === 0) return [];
    return SessionEpochService.bumpScopes(supabase, scopes);
}

export async function GET(request: Request) {
    try {
        await requirePermission('system_settings');

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('id, key, value, description, updated_at')
            .order('key', { ascending: true });

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return authFailure(error) || NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        await requirePermission('system_settings');

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const body = await request.json();
        const parseResult = AdvancedSettingPostSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }

        const { key, value, description } = parseResult.data;

        const { data, error } = await supabase
            .from('SystemConfigs')
            .insert({
                key,
                value,
                description,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        const loggedOutScopes = await bumpSessionsFor(supabase, [key]);

        return NextResponse.json({ success: true, data, loggedOutScopes });
    } catch (error: any) {
        return authFailure(error) || NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        await requirePermission('system_settings');

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const body = await request.json();
        const parseResult = AdvancedSettingPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }

        const { id, key, value, description } = parseResult.data;

        // Đổi TÊN khoá là vô hiệu hoá khoá cũ và dựng lên một khoá mới — cả hai
        // phía đều có thể là công tắc, nên phải soi tên cũ lẫn tên mới.
        const { data: before } = await supabase
            .from('SystemConfigs').select('key').eq('id', id).maybeSingle();

        const updateData: any = { updated_at: new Date().toISOString() };
        if (key !== undefined) updateData.key = key;
        if (value !== undefined) updateData.value = value;
        if (description !== undefined) updateData.description = description;

        const { data, error } = await supabase
            .from('SystemConfigs')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        const loggedOutScopes = await bumpSessionsFor(supabase, [before?.key, key]);

        return NextResponse.json({ success: true, data, loggedOutScopes });
    } catch (error: any) {
        return authFailure(error) || NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        await requirePermission('system_settings');

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        // Xoá dòng công tắc = quay về mặc định của code, cũng là một thay đổi
        // cấu hình. Đọc tên trước khi xoá vì sau đó không còn gì để đọc.
        const { data: before } = await supabase
            .from('SystemConfigs').select('key').eq('id', id).maybeSingle();

        const { error } = await supabase
            .from('SystemConfigs')
            .delete()
            .eq('id', id);

        if (error) throw error;

        const loggedOutScopes = await bumpSessionsFor(supabase, [before?.key]);

        return NextResponse.json({ success: true, loggedOutScopes });
    } catch (error: any) {
        return authFailure(error) || NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
