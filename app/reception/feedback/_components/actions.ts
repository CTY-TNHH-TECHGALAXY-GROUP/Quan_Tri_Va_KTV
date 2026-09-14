'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

import { MAX_RATING_WITH_VIOLATION } from './feedback.constants';

/** Một ô góp ý khách đã tích, kèm nội dung chụp lại lúc bấm. */
type ViolationDetail = { id: string; text: string };

/**
 * Cột `violations` ở `BookingGuests` / `BookingItems` do migration
 * 20260907000000 thêm vào. Trước khi migration được chạy thì cột chưa tồn tại,
 * và nếu cứ ghi thẳng thì PostgREST trả lỗi PGRST204 làm HỎNG CẢ việc gửi đánh
 * giá — khách không gửi được. Nên phải dò trước, thiếu cột thì bỏ qua phần đó
 * và vẫn ghi được sao + ghi chú như cũ.
 */
async function hasViolationsColumn(supabase: any, table: string): Promise<boolean> {
    const { error } = await supabase.from(table).select('violations').limit(1);
    if (error) {
        console.warn(`[Feedback Action] ${table}.violations chưa có — bỏ qua. Chạy migration 20260907000000 để bật.`);
        return false;
    }
    return true;
}

/** Đổi mã ô góp ý thành [{id, text}] để lưu kèm nội dung, khỏi join lại sau này. */
async function buildViolationDetails(supabase: any, ids: string[]): Promise<ViolationDetail[]> {
    if (!ids || ids.length === 0) return [];
    const { data, error } = await supabase
        .from('Reminders_Customer')
        .select('id, contentVN')
        .in('id', ids);
    if (error || !data) return ids.map(id => ({ id: String(id), text: '' }));

    const map = new Map(data.map((r: any) => [String(r.id), r.contentVN || '']));
    return ids.map(id => ({ id: String(id), text: String(map.get(String(id)) || '') }));
}

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
        const { bookingId, isGuestFlow, ktvList, globalComment, violations } = payload;

        // Kẹp trần theo số lỗi khách tích. Mọi chỗ ghi điểm bên dưới đều phải dùng
        // `globalRating` đã kẹp này, không được dùng lại `payload.globalRating`.
        const globalRating = (violations && violations.length > 0)
            ? Math.min(payload.globalRating, MAX_RATING_WITH_VIOLATION)
            : payload.globalRating;

        if (globalRating !== payload.globalRating) {
            console.warn(
                `[Feedback Action] Đơn ${bookingId}: khách tích ${violations.length} lỗi nhưng chấm ` +
                `${payload.globalRating} sao → hạ về ${globalRating} sao.`
            );
        }
        
        // 1. Lấy danh sách các Item ID hoặc Guest ID cần update
        const itemIdsToUpdate = Array.from(new Set(ktvList.map((k) => k.itemId)));

        // Lỗi khách tích: ghi xuống TỪNG KHÁCH / TỪNG DỊCH VỤ, không đè lên bill.
        // Trước đây chỉ có `Bookings.violations` nên bill nhiều khách thì ai chấm
        // sau xoá sạch tố cáo của người chấm trước — xem migration 20260907000000.
        const violationDetails = await buildViolationDetails(supabase, violations);
        const guestHasCol = await hasViolationsColumn(supabase, 'BookingGuests');
        const itemHasCol = await hasViolationsColumn(supabase, 'BookingItems');
        
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
                    ...(guestHasCol && { violations: violationDetails }),
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
                        itemRating: globalRating,
                        ...(itemHasCol && { violations: violationDetails })
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
                    ...(itemFeedback !== null && { itemFeedback: itemFeedback }),
                    ...(itemHasCol && { violations: violationDetails })
                }).eq('id', item.id);

                if (updateItemErr) throw updateItemErr;
            }
        }
        
        // ─── Bản tổng hợp lỗi ở cấp bill ───
        // Phải GỘP LẠI từ tất cả các khách, TUYỆT ĐỐI không ghi đè bằng lỗi của
        // riêng khách vừa chấm — đó chính là lỗi cũ làm mất tố cáo của khách trước.
        // Dựng lại từ đầu mỗi lần nên tự đúng cả khi khách bỏ tích rồi chấm lại.
        let bookingViolations: ViolationDetail[] = violationDetails;
        if (guestHasCol) {
            const { data: allGuests } = await supabase
                .from('BookingGuests')
                .select('violations')
                .eq('booking_id', bookingId);

            const merged = new Map<string, ViolationDetail>();
            for (const g of allGuests || []) {
                for (const v of (Array.isArray(g.violations) ? g.violations : [])) {
                    if (v && v.id) merged.set(String(v.id), v as ViolationDetail);
                }
            }
            // Luồng cũ (không có BookingGuests) thì `allGuests` rỗng — vẫn phải
            // giữ lỗi của lần chấm này, nếu không bill legacy sẽ trống trơn.
            if (merged.size > 0) bookingViolations = Array.from(merged.values());
        }

        // Cập nhật trạng thái Bookings
        // A finished booking is never pulled back. Since 14/09 the DB job
        // `auto_complete_unrated_feedback` closes an unrated order 5 minutes after
        // it enters FEEDBACK, and the customer may still rate it afterwards (late
        // rating is recorded, money recomputes via the ledger trigger).
        const { data: currentBooking } = await supabase
            .from('Bookings').select('status').eq('id', bookingId).maybeSingle();
        const keepFinishedStatus = String(currentBooking?.status || '') === 'DONE';
        const bookingFeedback = globalComment.trim() || null;
        const { error: updateBookingErr } = await supabase.from('Bookings').update({
            ...(!keepFinishedStatus && { status: 'FEEDBACK' }),
            violations: bookingViolations,
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
