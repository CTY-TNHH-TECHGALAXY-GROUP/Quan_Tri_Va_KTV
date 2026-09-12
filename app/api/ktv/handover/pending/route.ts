import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService } from '@/lib/services/HandoverService';

/**
 * GET /api/ktv/handover/pending?ktvCode=NH025
 * Returns list of BookingItems that KTV has skipped handover (pending debt).
 * Used by Dashboard to show reminder widget.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const ktvCode = searchParams.get('ktvCode');

        if (!ktvCode) {
            return NextResponse.json(
                { success: false, error: 'ktvCode is required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const result = await HandoverService.getPendingHandovers(supabase, ktvCode);

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        console.error('API Error (GET /api/ktv/handover/pending):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
