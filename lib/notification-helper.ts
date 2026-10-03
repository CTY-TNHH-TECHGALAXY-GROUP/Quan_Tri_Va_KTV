import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * 🔔 Centralized Notification Helper
 * Insert vào StaffNotifications — Push notification sẽ do Supabase DB Webhook
 * (trigger-webhook/route.ts) xử lý tự động khi INSERT.
 * 
 * ⚠️ QUAN TRỌNG: Helper này KHÔNG gửi Push trực tiếp nữa.
 * Lý do: Trước đây code gửi Push tại đây + Webhook cũng gửi Push → KTV nhận đúp 2 lần.
 * Giờ tập trung gửi Push duy nhất tại trigger-webhook để tránh trùng lặp.
 */

interface NotifyPayload {
    type: string;
    message: string;
    employeeId?: string | null;
    bookingId?: string | null;
}

export async function createNotification(payload: NotifyPayload) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        console.error('❌ [Notify] Supabase not initialized');
        return;
    }

    // Insert into StaffNotifications (for Realtime + history)
    // Push notification will be triggered automatically by Supabase DB Webhook → trigger-webhook/route.ts
    const { error: insertErr } = await supabase
        .from('StaffNotifications')
        .insert({
            type: payload.type,
            message: payload.message,
            employeeId: payload.employeeId || null,
            bookingId: payload.bookingId || null,
            isRead: false,
        });

    if (insertErr) {
        console.error('❌ [Notify] Insert failed:', insertErr);
        return;
    }

    console.log(`📡 [Notify] Inserted "${payload.type}" notification. Push will be handled by DB Webhook.`);
}

