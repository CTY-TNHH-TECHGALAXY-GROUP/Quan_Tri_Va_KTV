import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SessionEpochService } from '@/lib/services/SessionEpochService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/session-check?staffId=NH001&issuedAt=<ISO>
 *
 * Session của người này còn hiệu lực không. Client hỏi định kỳ + mỗi lần
 * quay lại tab, nên máy nào không bao giờ đăng xuất vẫn nhận được thay đổi.
 *
 * Route nằm dưới /api/auth nên middleware không đụng tới — phải trả lời được
 * cả khi JWT đã hết hạn, vì đó cũng là lúc cần đá người dùng ra nhất.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId');
        const issuedAt = searchParams.get('issuedAt');

        if (!staffId) {
            return NextResponse.json({ success: false, error: 'Thiếu staffId' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            // Không kết nối được thì KHÔNG đá ai ra — lỗi hạ tầng mà đăng xuất
            // cả hệ thống thì tệ hơn nhiều so với chậm nhận cấu hình mới.
            return NextResponse.json({ success: true, mustLogout: false });
        }

        const [result, { data: staff }] = await Promise.all([
            SessionEpochService.check(supabase, staffId, issuedAt),
            supabase.from('Staff').select('status, lock_source').eq('id', staffId).maybeSingle(),
        ]);

        // Lock state rides on this poll so the lock / maintenance screen is
        // GLOBAL: it survives page navigation, shows up when the app is
        // reopened, and clears on unlock — without relying on Realtime
        // (payload.old needs REPLICA IDENTITY FULL, which is not set).
        const locked = staff?.status === 'KHÓA_TÀI_KHOẢN';
        const lockKind = !locked ? null : (staff as any)?.lock_source === 'MANUAL' ? 'MANUAL' : 'DISCIPLINE';

        return NextResponse.json({ success: true, ...result, locked, lockKind });
    } catch (err: any) {
        console.error('❌ [session-check]', err);
        return NextResponse.json({ success: true, mustLogout: false });
    }
}
