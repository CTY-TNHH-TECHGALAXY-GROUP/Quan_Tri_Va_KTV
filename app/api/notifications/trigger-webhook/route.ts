import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendPushNotification } from '@/lib/push-helper';
import { WebhookRecordSchema } from '@/lib/schemas/notification.schema';

interface NotifRule {
    allowed_roles: string[];
    include_target_employee: boolean;
    enabled: boolean;
    require_on_shift?: boolean;
}

/**
 * POST /api/notifications/trigger-webhook
 * Receives database webhook event from Supabase on StaffNotifications insert
 * and triggers matching Web Push notifications.
 * 
 * ⚠️ ĐÂY LÀ ĐƯỜNG GỬI PUSH DUY NHẤT.
 * notification-helper.ts chỉ INSERT vào DB, KHÔNG gửi Push trực tiếp.
 * Supabase DB Webhook bắt INSERT → gọi route này → route này gửi Push.
 */
export async function POST(request: Request) {
    try {
        // 1. Verify webhook secret
        const authHeader = request.headers.get('x-webhook-secret');
        const secret = process.env.WEBHOOK_SECRET || 'nganha-webhook-secret-2026';
        if (authHeader !== secret) {
            console.warn('⚠️ [Webhook] Unauthorized webhook call. Header:', authHeader);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        // Supabase DB Webhook format sends details in body.record
        const rawRecord = body.record || body;
        
        const parseResult = WebhookRecordSchema.safeParse(rawRecord);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const record = parseResult.data;

        console.log('🔔 [Webhook] Received notification insert:', record.id, 'Type:', record.type);

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin client not initialized');

        // 2. Fetch rules to determine if push should be sent
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'notification_rules')
            .maybeSingle();

        const rules = configData?.value as Record<string, NotifRule> | null;
        const rule = rules?.[record.type];

        if (!rule || !rule.enabled) {
            console.log(`📡 [Webhook] Push skipped — type "${record.type}" disabled or no rule config`);
            return NextResponse.json({ success: true, message: 'Push skipped' });
        }

        // 3. Clean message from any metadata tags like [AID:...] or [AUTO]
        const cleanMessage = record.message
            .replace(/\[AID:[a-f0-9-]+\]/gi, '')
            .replace(/\[AUTO\]/gi, '')
            .trim();

        // 4. Determine if on-shift filtering should be applied
        const shouldFilterOnShift = rule.require_on_shift === true;

        // 5. Dispatch Push Notifications based on rule targets
        let pushSent = false;
        
        if (record.employeeId && rule.include_target_employee) {
            // Push to target employee (always send regardless of on-shift for explicit targets)
            await sendPushNotification({
                title: `${record.type === 'REWARD' ? '🎁' : '🔔'} Thông báo`,
                message: cleanMessage,
                targetStaffIds: [record.employeeId],
                url: '/',
                requireOnShift: false, // Explicit target: always deliver
            });
            pushSent = true;

            // Also push to allowed roles (e.g. admins when a KTV gets rewarded)
            if (rule.allowed_roles && rule.allowed_roles.length > 0) {
                const targetRoles = rule.allowed_roles.map((r: string) => r.toUpperCase());
                await sendPushNotification({
                    title: '🔔 Thông báo',
                    message: cleanMessage,
                    targetRoles,
                    url: '/',
                    requireOnShift: shouldFilterOnShift,
                });
            }
        } else if (rule.allowed_roles && rule.allowed_roles.length > 0) {
            // Push only to allowed roles
            const targetRoles = rule.allowed_roles.map((r: string) => r.toUpperCase());
            await sendPushNotification({
                title: '🔔 Thông báo',
                message: cleanMessage,
                targetRoles,
                url: '/',
                requireOnShift: shouldFilterOnShift,
            });
            pushSent = true;
        }

        console.log(`📡 [Webhook] Push dispatch completed. Push sent:`, pushSent, `| On-shift filter:`, shouldFilterOnShift);
        return NextResponse.json({ success: true, pushSent });
    } catch (error: any) {
        console.error('❌ [Webhook] Error processing notification webhook:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

