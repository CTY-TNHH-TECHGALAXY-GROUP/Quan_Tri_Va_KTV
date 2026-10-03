import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService } from '@/lib/services/HandoverService';
import { requireActiveStaff, requireStaffMatches } from '@/lib/auth-server';

/**
 * POST /api/ktv/handover/skip
 * KTV skips handover to go to the next order.
 * Body: { bookingItemId: string, ktvCode: string }
 */
export async function POST(request: Request) {
    try {
        // Tài khoản bị khoá thì không thao tác được nữa, kể cả khi phiên
        // đăng nhập đã cấp từ trước lúc khoá.
        const lockedError = await requireActiveStaff();
        if (lockedError) return lockedError;

        const body = await request.json();
        const { bookingItemId, ktvCode } = body;

        if (!bookingItemId || !ktvCode) {
            return NextResponse.json(
                { success: false, error: 'bookingItemId and ktvCode are required' },
                { status: 400 }
            );
        }

        // Hạn mức bỏ qua đếm theo TỪNG KTV. Nhận `ktvCode` thẳng từ body mà không
        // đối chiếu thì gửi mã đồng nghiệp là tiêu vào hạn mức của họ, lượt của
        // mình còn nguyên — hạn mức "3 lần" trở thành vô nghĩa.
        const wrongStaff = await requireStaffMatches(ktvCode);
        if (wrongStaff) return wrongStaff;

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const result = await HandoverService.skipHandover(supabase, bookingItemId, ktvCode);
        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('API Error (POST /api/ktv/handover/skip):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
