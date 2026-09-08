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

        const result = await SessionEpochService.check(supabase, staffId, issuedAt);

        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        console.error('❌ [session-check]', err);
        return NextResponse.json({ success: true, mustLogout: false });
    }
}
