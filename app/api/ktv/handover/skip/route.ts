import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService } from '@/lib/services/HandoverService';

/**
 * POST /api/ktv/handover/skip
 * KTV skips handover to go to the next order.
 * Body: { bookingItemId: string, ktvCode: string }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { bookingItemId, ktvCode } = body;

        if (!bookingItemId || !ktvCode) {
            return NextResponse.json(
                { success: false, error: 'bookingItemId and ktvCode are required' },
                { status: 400 }
            );
        }

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
