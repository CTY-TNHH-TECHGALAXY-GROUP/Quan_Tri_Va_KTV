'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function submitFeedbackAction(payload: {
    bookingId: string;
    isGuestFlow: boolean;
    ktvList: { itemId: string; ktvId: string; ktvName: string }[];
    globalRating: number;
    globalComment: string;
    violations: string[];
}) {
    const supabase = getSupabaseAdmin();
    if (!supabase) return { success: false, error: 'No admin client' };
    
    try {
        const { bookingId, isGuestFlow, ktvList, globalRating, globalComment, violations } = payload;
        
        // 1. Lấy danh sách các Item ID hoặc Guest ID cần update
        const itemIdsToUpdate = Array.from(new Set(ktvList.map((k) => k.itemId)));
        
        if (isGuestFlow) {
            // Update BookingGuests
            const { data: currentGuests, error: fetchGuestErr } = await supabase
                .from('BookingGuests')
                .select('id, ktv_ratings')
                .in('id', itemIdsToUpdate);

            if (fetchGuestErr) throw fetchGuestErr;

            for (const guest of currentGuests || []) {
                let currentRatings = guest.ktv_ratings || {};
                ktvList.forEach((k) => { 
                    if (k.itemId === guest.id) currentRatings[k.ktvId] = globalRating; 
                });
                
                const guestFeedback = globalComment.trim() || null;
                const { error: updateGuestErr } = await supabase.from('BookingGuests').update({
                    ktv_ratings: currentRatings,
                    rating: globalRating,
                    ...(guestFeedback !== null && { guest_feedback: guestFeedback }),
                    status: 'DONE',
                    updated_at: new Date().toISOString()
                }).eq('id', guest.id);

                if (updateGuestErr) throw updateGuestErr;
            }
            
            // Sync kép qua BookingItems
            const { data: guestItems, error: fetchItemErr } = await supabase
                .from('BookingItems')
                .select('id, guest_id, technicianCodes, ktvRatings')
                .in('guest_id', itemIdsToUpdate);

            if (fetchItemErr) throw fetchItemErr;

            for (const item of guestItems || []) {
                let currentRatings = item.ktvRatings || {};
                let hasChanges = false;

                ktvList.forEach((k) => {
                    if (k.itemId === item.guest_id && item.technicianCodes?.includes(k.ktvId)) {
                        currentRatings[k.ktvId] = globalRating;
                        hasChanges = true;
                    }
                });

                if (hasChanges) {
                    const { error: updateItemErr } = await supabase.from('BookingItems').update({
                        ktvRatings: currentRatings,
                        itemRating: globalRating
                    }).eq('id', item.id);

                    if (updateItemErr) throw updateItemErr;
                }
            }
            
        } else {
            // Legacy Flow update trực tiếp vào BookingItems
            const { data: currentItems, error: fetchItemErr } = await supabase
                .from('BookingItems')
                .select('id, ktvRatings')
                .in('id', itemIdsToUpdate);

            if (fetchItemErr) throw fetchItemErr;

            for (const item of currentItems || []) {
                let currentRatings = item.ktvRatings || {};
                ktvList.forEach((k) => {
                    if (k.itemId === item.id) currentRatings[k.ktvId] = globalRating;
                });

                const itemFeedback = globalComment.trim() || null;
                const { error: updateItemErr } = await supabase.from('BookingItems').update({
                    ktvRatings: currentRatings,
                    itemRating: globalRating,
                    ...(itemFeedback !== null && { itemFeedback: itemFeedback })
                }).eq('id', item.id);

                if (updateItemErr) throw updateItemErr;
            }
        }
        
        // Cập nhật trạng thái Bookings
        const bookingFeedback = globalComment.trim() || null;
        const { error: updateBookingErr } = await supabase.from('Bookings').update({
            status: 'FEEDBACK',
            violations: violations,
            rating: globalRating,
            ...(bookingFeedback !== null && { feedbackNote: bookingFeedback }),
            updatedAt: new Date().toISOString()
        }).eq('id', bookingId);

        if (updateBookingErr) throw updateBookingErr;
        
        // Push Notifications cho Staff
        const ratingText = globalRating >= 4 ? 'Xuất sắc' : globalRating === 3 ? 'Tốt' : globalRating === 2 ? 'Tạm được' : 'Tệ';
        const notifPayloads = ktvList.map((k) => ({
            staffId: k.ktvId,
            type: 'FEEDBACK',
            title: `Khách hàng đánh giá: ${globalRating} sao`,
            message: `Khách hàng đã đánh giá ${ratingText} (${globalRating} sao) cho ${k.ktvName}.` + (globalComment ? ` Ghi chú: ${globalComment}` : ''),
            source: 'SYSTEM',
            referenceId: bookingId,
            isRead: false
        }));
        
        if (notifPayloads.length > 0) {
            const { error: notifErr } = await supabase.from('StaffNotifications').insert(notifPayloads);
            if (notifErr) console.error('[Feedback Action] Lỗi khi tạo notification:', notifErr);
        }
        
        return { success: true };
    } catch (err: any) {
        console.error("[Feedback Action] error:", err);
        return { success: false, error: err.message };
    }
}
