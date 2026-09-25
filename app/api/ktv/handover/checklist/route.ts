import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService } from '@/lib/services/HandoverService';

/**
 * GET /api/ktv/handover/checklist?roomId=V1&serviceCode=NHS0607&serviceCategory=Ear+Clean&bookingId=xxx&bookingItemId=yyy
 * Returns dynamic checklist for a specific KTV based on room + service they did.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const roomId = searchParams.get('roomId');
        const serviceCode = searchParams.get('serviceCode') || '';
        const serviceCategory = searchParams.get('serviceCategory') || '';
        const bookingId = searchParams.get('bookingId');
        const bookingItemId = searchParams.get('bookingItemId');

        if (!bookingId || !bookingItemId) {
            return NextResponse.json(
                { success: false, error: 'bookingId and bookingItemId are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const checklist = await HandoverService.generateDynamicChecklist(
            supabase,
            roomId,
            serviceCode,
            serviceCategory,
            bookingId,
            bookingItemId
        );

        return NextResponse.json({ success: true, checklist });
    } catch (error: any) {
        console.error('API Error (GET /api/ktv/handover/checklist):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
