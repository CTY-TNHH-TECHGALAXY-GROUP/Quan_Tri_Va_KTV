import { NextResponse } from 'next/server';
import { BookingDetails, renderBookingEmailHtml, sendBookingConfirmationEmail, buildVietQrUrl } from '@/lib/email';
import { EmailConfig, getEmailConfig } from '@/lib/email-config';
import { EmailTestSchema } from '@/lib/schemas/admin.schema';
import { requirePermission } from '@/lib/auth-server';

/**
 * Đơn hàng mẫu dùng cho xem trước & gửi thử — mô phỏng đơn nhiều dịch vụ để thấy
 * đủ các trường hợp: mỗi dịch vụ một yêu cầu, KTV khác nhau, ghi chú riêng từng dịch vụ.
 * Giá trị dùng nhãn chuẩn tiếng Việt, email tự dịch theo ngôn ngữ đang xem.
 */
const SAMPLE_BOOKING: BookingDetails = {
    bookingId: 'WB-DEMO-0001',
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: '14:30',
    services: [
        { name: 'Gói dịch vụ cao cấp', duration: 120 },
        { name: 'Tinh dầu dừa', duration: 60 },
        { name: 'Cạo/tỉa râu', duration: 30 },
    ],
    duration: 210,
    guests: 3,
    depositAmount: 600000,
    totalAmount: 1575000,
    therapist: '',
    servicePrefs: [
        { name: 'Gói dịch vụ cao cấp', focus: 'Đầu, Cổ, Lưng', avoid: 'Vai, Tay', strength: 'Vừa', therapist: 'Nữ' },
        { name: 'Tinh dầu dừa', focus: 'Vai, Tay', avoid: 'Cổ, Đầu', strength: 'Mạnh' },
        { name: 'Cạo/tỉa râu', note: 'Có dị ứng' },
    ],
    therapistRequests: ['Nữ', '', ''],
    note: 'Quý khách bị dị ứng với tinh dầu bạc hà, vui lòng thay bằng tinh dầu tràm trà.',
};

function renderSample(cfg: EmailConfig, language: string, isNewCustomer: boolean) {
    // Bản xem trước dùng ảnh QR thật (thay cho cid: chỉ hoạt động trong hòm thư)
    const qrIntl = 'https://placehold.co/200x200/png?text=International+QR';
    const qrLocal = buildVietQrUrl(cfg, SAMPLE_BOOKING.depositAmount, SAMPLE_BOOKING.bookingId);
    return renderBookingEmailHtml(cfg, 'Nguyễn Văn A', language, isNewCustomer, SAMPLE_BOOKING, qrIntl, qrLocal);
}

/** Ánh xạ lỗi phân quyền sang đúng mã HTTP thay vì trả 500 cho mọi trường hợp. */
function errorStatus(message?: string) {
    if (message === 'Forbidden') return 403;
    if (message === 'Unauthorized') return 401;
    return 500;
}

// Giới hạn tần suất gửi thử (bộ nhớ tiến trình — đủ cho thao tác thủ công của admin)
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
let sendTimestamps: number[] = [];

function takeSendSlot(): boolean {
    const now = Date.now();
    sendTimestamps = sendTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (sendTimestamps.length >= RATE_LIMIT_MAX) return false;
    sendTimestamps.push(now);
    return true;
}

/**
 * GET /api/admin/settings/email/test?lang=vi&newCustomer=true
 * Trả về HTML email mẫu để xem trước trong iframe.
 */
export async function GET(request: Request) {
    try {
        await requirePermission('system_settings');

        const { searchParams } = new URL(request.url);
        const language = searchParams.get('lang') || 'vi';
        const isNewCustomer = searchParams.get('newCustomer') !== 'false';

        const cfg = await getEmailConfig();
        const html = renderSample(cfg, language, isNewCustomer);

        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: errorStatus(error.message) });
    }
}

/**
 * POST /api/admin/settings/email/test
 * Body: { to: string, lang?: string, newCustomer?: boolean }
 * Gửi một email mẫu tới địa chỉ chỉ định (bỏ qua công tắc email_enabled).
 */
export async function POST(request: Request) {
    try {
        await requirePermission('system_settings');

        // Chặn lạm dụng: endpoint này gửi mail thật qua tài khoản SMTP của spa,
        // nên giới hạn số lần gửi thử trong mỗi cửa sổ thời gian.
        if (!takeSendSlot()) {
            return NextResponse.json(
                { success: false, error: `Đã gửi quá ${RATE_LIMIT_MAX} email thử trong ${RATE_LIMIT_WINDOW_MS / 60000} phút. Vui lòng thử lại sau.` },
                { status: 429 }
            );
        }

        const body = await request.json();
        const parseResult = EmailTestSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }

        const { to, lang = 'vi', newCustomer = true } = parseResult.data;

        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            return NextResponse.json(
                { success: false, error: 'Chưa cấu hình SMTP_HOST / SMTP_USER / SMTP_PASS trong biến môi trường.' },
                { status: 400 }
            );
        }

        const result = await sendBookingConfirmationEmail(
            to,
            'Nguyễn Văn A',
            lang,
            newCustomer,
            SAMPLE_BOOKING,
            { force: true } // Gửi thử vẫn chạy kể cả khi đang TẮT gửi email
        );

        if (!result.success) {
            const message = result.error instanceof Error ? result.error.message : String(result.error ?? 'Gửi thất bại');
            return NextResponse.json({ success: false, error: message }, { status: 500 });
        }

        return NextResponse.json({ success: true, messageId: result.messageId });
    } catch (error: any) {
        console.error('Lỗi gửi email thử:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: errorStatus(error.message) });
    }
}
