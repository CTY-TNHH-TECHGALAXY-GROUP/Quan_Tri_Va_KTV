import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireBusinessUser, authErrorResponse } from '@/lib/auth-server';

/**
 * GET /api/staff/list
 * Returns a simple list of all active staff members (id + full_name)
 * for use in dropdown selectors.
 *
 * Loại C có mặt ở đây từ 12/09/2026 (tài khoản thật). Mã placeholder cũ
 * (EXT_/C_) đã `ĐÃ NGHỈ` nên bộ lọc status tự loại chúng.
 */
export async function GET() {
    try {
        // Danh sách nhân viên là dữ liệu nội bộ → phải đăng nhập (cờ tắt thì cho qua như cũ).
        const u = await requireBusinessUser();
        if (!u && process.env.AUTH_ENFORCE_API === '1') {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data, error } = await supabase
            .from('Staff')
            .select('id, full_name')
            .eq('status', 'ĐANG LÀM')
            .order('full_name', { ascending: true });

        if (error) {
            console.error('❌ [Staff List] Query error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: data || [] });
    } catch (error: any) {
        const authRes = authErrorResponse(error);
        if (authRes) return authRes;
        console.error('❌ [Staff List] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
