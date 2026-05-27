import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * 🔔 Centralized Notification Helper
 * Insert vào StaffNotifications + tự động gửi Push nếu enabled
 * Dùng thay cho supabase.from('StaffNotifications').insert(...) ở mọi nơi
 */

interface NotifyPayload {
    type: string;
    message: string;
    employeeId?: string | null;
    bookingId?: string | null;
}

interface NotifRule {
    allowed_roles: string[];
    include_target_employee: boolean;
    enabled: boolean;
}

export async function createNotification(payload: NotifyPayload) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        console.error('❌ [Notify] Supabase not initialized');
        return;
    }

    // 1. Always insert into StaffNotifications (for Realtime + history)
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

    // 2. Read notification rules to check if push should be sent
    try {
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'notification_rules')
            .maybeSingle();

        const rules = configData?.value as Record<string, NotifRule> | null;
        const rule = rules?.[payload.type];

        // If rule disabled or not found → skip push
        if (!rule || !rule.enabled) {
            console.log(`📡 [Notify] Push skipped — type "${payload.type}" disabled or no rule`);
            return;
        }

        // 3. Determine push targets
        const { sendPushNotification } = await import('@/lib/push-helper');

        if (payload.employeeId && rule.include_target_employee) {
            // Push to specific employee + allowed roles
            const targetStaffIds = [payload.employeeId];
            const targetRoles = (rule.allowed_roles || []).map((r: string) => r.toUpperCase());

            // Send to target employee
            await sendPushNotification({
                title: `${payload.type === 'REWARD' ? '🎁' : '🔔'} Thông báo`,
                message: payload.message.replace(/\[AID:[a-f0-9-]+\]/gi, '').replace(/\[AUTO\]/gi, '').trim(),
                targetStaffIds,
                url: '/',
            }).catch(e => console.warn('⚠️ [Notify] Push to employee failed:', e.message));

            // Also send to allowed roles (e.g., admin for REWARD)
            if (targetRoles.length > 0) {
                await sendPushNotification({
                    title: `🔔 Thông báo`,
                    message: payload.message.replace(/\[AID:[a-f0-9-]+\]/gi, '').replace(/\[AUTO\]/gi, '').trim(),
                    targetRoles,
                    url: '/',
                }).catch(e => console.warn('⚠️ [Notify] Push to roles failed:', e.message));
            }
        } else if (rule.allowed_roles?.length > 0) {
            // Push to roles only (no specific employee)
            const targetRoles = rule.allowed_roles.map((r: string) => r.toUpperCase());
            await sendPushNotification({
                title: `🔔 Thông báo`,
                message: payload.message.replace(/\[AID:[a-f0-9-]+\]/gi, '').replace(/\[AUTO\]/gi, '').trim(),
                targetRoles,
                url: '/',
            }).catch(e => console.warn('⚠️ [Notify] Push to roles failed:', e.message));
        }

        console.log(`📡 [Notify] Push sent for type "${payload.type}"`);
    } catch (err) {
        // Push failure should never block the main flow
        console.error('⚠️ [Notify] Push error (non-blocking):', err);
    }
}
