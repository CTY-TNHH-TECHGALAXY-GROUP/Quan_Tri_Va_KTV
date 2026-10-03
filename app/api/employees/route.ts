import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireBusinessUser, authErrorResponse } from '@/lib/auth-server';

export async function GET() {
    try {
        // Phải đăng nhập mới xem được danh sách nhân viên. Mật khẩu chỉ trả cho
        // ADMIN/DEV — trước đây ai gọi API cũng nhận được mật khẩu của cả tiệm.
        const actor = await requireBusinessUser();
        if (!actor && process.env.AUTH_ENFORCE_API === '1') {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        const actorRole = String(actor?.role || '').toUpperCase();
        const canSeePassword = actorRole === 'ADMIN' || actorRole === 'DEV';

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data: staff, error } = await supabase
            .from('Staff')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch user login data to display username and password
        const { data: users, error: usersError } = await supabase
            .from('Users')
            .select('id, username, password');

        if (usersError) {
            console.warn("Could not fetch Users data", usersError);
        }

        const staffWithAuth = staff.map(s => {
            const authInfo = users?.find(u => u.id === s.id);
            return {
                ...s,
                username: authInfo?.username || s.id,
                password: canSeePassword ? (authInfo?.password || '---') : '---'
            };
        });

        return NextResponse.json({ success: true, data: staffWithAuth });
    } catch (error: any) {
        const authRes = authErrorResponse(error);
        if (authRes) return authRes;
        console.error('API Error (Employees):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
