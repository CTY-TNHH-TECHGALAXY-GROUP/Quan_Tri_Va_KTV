import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendPushNotification } from '@/lib/push-helper';
import { WebhookRecordSchema } from '@/lib/schemas/notification.schema';
import { isSilentNotification } from '@/lib/notification-kind';

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
        //
        // 🛡️ LUẬT BẤT DI BẤT DỊCH: thông báo CÓ `employeeId` là thông báo CÁ NHÂN.
        // Nó chỉ được đẩy cho chính chủ, cộng Admin/Quầy/Dev để theo dõi. TUYỆT ĐỐI
        // không phát theo vai trò KTV — kể cả khi rule tắt cờ `include_target_employee`.
        // Tắt cờ đó chỉ có nghĩa "chính chủ không cần push", KHÔNG BAO GIỜ có nghĩa
        // "bắn cho tất cả KTV". Trước đây nhánh `else` không biết `employeeId` tồn tại
        // nên rule COMPLAINT (allowed_roles có 'ktv', cờ target tắt) đã đẩy câu
        // "Bạn nhận được đánh giá TỆ" của MỘT người tới máy của MỌI KTV.
        // Tin xác nhận thì đẩy im lặng — hiện trên máy nhưng không kêu, không rung.
        const silent = isSilentNotification(record.type);
        const isTargeted = Boolean(record.employeeId);
        const targetRoles: string[] = (rule.allowed_roles || []).map((r: string) => r.toUpperCase());
        const isKtvRole = (r: string) => r === 'KTV' || r === 'TECHNICIAN';

        const nonKtvRoles = targetRoles.filter(r => !isKtvRole(r));
        // Tin cá nhân thì danh sách vai trò KTV luôn rỗng — chốt chặn ở code, không
        // phụ thuộc vào việc admin cấu hình đúng hay sai trong bảng Cài Đặt Thông Báo.
        const ktvRoles = isTargeted ? [] : targetRoles.filter(isKtvRole);

        let pushSent = false;

        if (isTargeted && rule.include_target_employee) {
            // Push cho đúng người được nhắm tới (không lọc theo ca)
            await sendPushNotification({
                title: `${record.type === 'REWARD' ? '🎁' : '🔔'} Thông báo`,
                message: cleanMessage,
                targetStaffIds: [record.employeeId as string],
                url: '/',
                requireOnShift: false, // Explicit target: always deliver
                silent,
            });
            pushSent = true;
        }

        if (nonKtvRoles.length > 0) {
            await sendPushNotification({
                title: '🔔 Thông báo',
                message: cleanMessage,
                targetRoles: nonKtvRoles,
                url: '/',
                requireOnShift: false, // Admin/Reception luôn nhận — không có trong TurnQueue
                silent,
            });
            pushSent = true;
        }

        if (ktvRoles.length > 0) {
            let ktvTitle = '🔔 Khách Mới';
            let ktvMessage = cleanMessage;
            // KTV không được xem chi tiết giá tiền/sđt của khách khi có đơn mới chung
            if (record.type === 'NEW_ORDER') {
                ktvMessage = 'Có khách mới vừa đặt lịch! Vui lòng chuẩn bị.';
            } else if (record.type === 'GUEST_ARRIVAL') {
                ktvTitle = '🔔 CÓ KHÁCH';
            }
            await sendPushNotification({
                title: ktvTitle,
                message: ktvMessage,
                targetRoles: ktvRoles,
                url: '/',
                requireOnShift: shouldFilterOnShift,
                silent,
            });
            pushSent = true;
        }

        if (isTargeted && !rule.include_target_employee) {
            console.log(`📡 [Webhook] "${record.type}" là tin cá nhân nhưng rule tắt include_target_employee — chính chủ ${record.employeeId} KHÔNG nhận push. Kiểm tra lại /admin/settings/notifications.`);
        }

        console.log(`📡 [Webhook] Push dispatch completed. Push sent:`, pushSent, `| On-shift filter:`, shouldFilterOnShift);
        return NextResponse.json({ success: true, pushSent });
    } catch (error: any) {
        console.error('❌ [Webhook] Error processing notification webhook:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

