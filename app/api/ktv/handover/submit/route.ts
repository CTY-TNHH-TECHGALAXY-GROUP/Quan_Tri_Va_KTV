import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService } from '@/lib/services/HandoverService';
import { requireActiveStaff } from '@/lib/auth-server';

/**
 * POST /api/ktv/handover/submit
 * KTV submits handover images for a BookingItem.
 * Body: { bookingItemId: string, images: { "Máy lạnh": ["url1"], ... } }
 */
export async function POST(request: Request) {
    try {
        // Tài khoản bị khoá thì không thao tác được nữa, kể cả khi phiên
        // đăng nhập đã cấp từ trước lúc khoá.
        const lockedError = await requireActiveStaff();
        if (lockedError) return lockedError;

        const body = await request.json();
        const { bookingItemId, images } = body;

        if (!bookingItemId || !images || typeof images !== 'object') {
            return NextResponse.json(
                { success: false, error: 'bookingItemId and images (object) are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const result = await HandoverService.submitHandover(supabase, bookingItemId, images);
        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('API Error (POST /api/ktv/handover/submit):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
