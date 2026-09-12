import { SupabaseClient } from '@supabase/supabase-js';

// =====================================================
// InternalReviewService — S.O.L.I.D Service Layer
// Plan: plan_handover_review_v5.md
// Single Responsibility: Internal reviews between Reception & KTV.
// =====================================================

export interface ReviewPayload {
    bookingId: string;
    reviewerId: string;     // VD: "NH025" hoặc "RECEPTION_01"
    reviewerRole: 'RECEPTION' | 'KTV';
    targetId: string;       // VD: "NH025" hoặc "RECEPTION_01"
    targetRole: 'RECEPTION' | 'KTV';
    rating: number;         // 1-5
    comment?: string;
}

export interface ReviewResult {
    success: boolean;
    error?: string;
    isExisting?: boolean;   // true nếu đã đánh giá rồi (UNIQUE constraint)
}

export class InternalReviewService {

    /**
     * Submit an internal review.
     * Handles UNIQUE constraint violation gracefully (Loophole #9).
     */
    static async submitReview(
        supabase: SupabaseClient,
        payload: ReviewPayload
    ): Promise<ReviewResult> {
        // Validate rating
        if (payload.rating < 1 || payload.rating > 5) {
            return { success: false, error: 'Rating must be between 1 and 5' };
        }

        // Check if already reviewed
        const { data: existing } = await supabase
            .from('InternalReviews')
            .select('id, rating, comment')
            .eq('booking_id', payload.bookingId)
            .eq('reviewer_id', payload.reviewerId)
            .eq('target_id', payload.targetId)
            .maybeSingle();

        if (existing) {
            return {
                success: true,
                isExisting: true,
                error: 'Bạn đã đánh giá người này trong đơn hàng này rồi.'
            };
        }

        // Insert review
        const { error } = await supabase
            .from('InternalReviews')
            .insert({
                booking_id: payload.bookingId,
                reviewer_id: payload.reviewerId,
                reviewer_role: payload.reviewerRole,
                target_id: payload.targetId,
                target_role: payload.targetRole,
                rating: payload.rating,
                comment: payload.comment || null,
            });

        if (error) {
            // Handle unique constraint violation (race condition fallback)
            if (error.code === '23505') {
                return { success: true, isExisting: true, error: 'Đã đánh giá rồi.' };
            }
            return { success: false, error: error.message };
        }

        return { success: true };
    }

    /**
     * Get all internal reviews for a booking.
     */
    static async getReviewsForBooking(
        supabase: SupabaseClient,
        bookingId: string
    ): Promise<any[]> {
        const { data } = await supabase
            .from('InternalReviews')
            .select('*')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: true });

        return data || [];
    }

    /**
     * Get average rating for a target (KTV or Reception) across all bookings.
     * Useful for admin dashboard / performance reports.
     */
    static async getAverageRating(
        supabase: SupabaseClient,
        targetId: string,
        targetRole: 'RECEPTION' | 'KTV'
    ): Promise<{ average: number; count: number }> {
        const { data } = await supabase
            .from('InternalReviews')
            .select('rating')
            .eq('target_id', targetId)
            .eq('target_role', targetRole);

        if (!data || data.length === 0) return { average: 0, count: 0 };

        const sum = data.reduce((acc, r) => acc + r.rating, 0);
        return {
            average: Math.round((sum / data.length) * 10) / 10,
            count: data.length,
        };
    }
}
