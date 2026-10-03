import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { InternalReviewService, ReviewPayload } from '@/lib/services/InternalReviewService';

/**
 * POST /api/internal-review
 * Submit an internal review (Reception <-> KTV, both directions).
 * Body: { bookingId, reviewerId, reviewerRole, targetId, targetRole, rating, comment? }
 * 
 * GET /api/internal-review?bookingId=xxx
 * Get all internal reviews for a booking.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { bookingId, reviewerId, reviewerRole, targetId, targetRole, rating, comment } = body;

        if (!bookingId || !reviewerId || !reviewerRole || !targetId || !targetRole || !rating) {
            return NextResponse.json(
                { success: false, error: 'All fields are required: bookingId, reviewerId, reviewerRole, targetId, targetRole, rating' },
                { status: 400 }
            );
        }

        if (!['RECEPTION', 'KTV'].includes(reviewerRole) || !['RECEPTION', 'KTV'].includes(targetRole)) {
            return NextResponse.json(
                { success: false, error: 'reviewerRole and targetRole must be RECEPTION or KTV' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const payload: ReviewPayload = {
            bookingId,
            reviewerId,
            reviewerRole,
            targetId,
            targetRole,
            rating: parseInt(rating, 10),
            comment,
        };

        const result = await InternalReviewService.submitReview(supabase, payload);

        if (result.isExisting) {
            return NextResponse.json({ success: true, isExisting: true, message: result.error });
        }

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('API Error (POST /api/internal-review):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const bookingId = searchParams.get('bookingId');

        if (!bookingId) {
            return NextResponse.json(
                { success: false, error: 'bookingId is required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const reviews = await InternalReviewService.getReviewsForBooking(supabase, bookingId);

        return NextResponse.json({ success: true, reviews });
    } catch (error: any) {
        console.error('API Error (GET /api/internal-review):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
