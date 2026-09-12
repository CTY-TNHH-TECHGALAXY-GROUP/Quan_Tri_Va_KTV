import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { EMAIL_CONFIG_DEFAULTS, EMAIL_CONFIG_KEYS, getEmailConfig } from '@/lib/email-config';
import { EmailSettingsSchema } from '@/lib/schemas/admin.schema';
import { requirePermission } from '@/lib/auth-server';

/** Ánh xạ lỗi phân quyền sang đúng mã HTTP thay vì trả 500 cho mọi trường hợp. */
function errorStatus(message?: string) {
    if (message === 'Forbidden') return 403;
    if (message === 'Unauthorized') return 401;
    return 500;
}

/** GET /api/admin/settings/email — lấy cấu hình Email (đã merge với mặc định). */
export async function GET() {
    try {
        await requirePermission('system_settings');

        const config = await getEmailConfig();
        return NextResponse.json({
            success: true,
            data: config,
            defaults: EMAIL_CONFIG_DEFAULTS,
            // Cho UI biết SMTP đã cấu hình ở biến môi trường hay chưa
            smtp: {
                configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
                host: process.env.SMTP_HOST || null,
                fromEmail: process.env.SMTP_FROM_EMAIL || null,
                fromName: process.env.SMTP_FROM_NAME || null,
                replyTo: process.env.SMTP_REPLY_TO || null,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: errorStatus(error.message) });
    }
}

/** PATCH /api/admin/settings/email — lưu các key cấu hình Email vào SystemConfigs. */
export async function PATCH(request: Request) {
    try {
        await requirePermission('system_settings');

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });

        const body = await request.json();
        const parseResult = EmailSettingsSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }

        const validBody = parseResult.data;

        // Chỉ cho phép ghi đúng các key thuộc nhóm cấu hình Email
        const keys = Object.keys(validBody).filter(k => (EMAIL_CONFIG_KEYS as string[]).includes(k));
        if (keys.length === 0) {
            return NextResponse.json({ success: false, error: 'Không có key cấu hình Email hợp lệ.' }, { status: 400 });
        }

        const { error } = await supabase.from('SystemConfigs').upsert(
            keys.map(key => ({
                key,
                value: (validBody as any)[key],
                updated_at: new Date().toISOString(),
            })),
            { onConflict: 'key' }
        );

        if (error) throw error;

        return NextResponse.json({ success: true, data: await getEmailConfig() });
    } catch (error: any) {
        console.error('Lỗi lưu cấu hình Email:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: errorStatus(error.message) });
    }
}
