import { NextResponse } from 'next/server';
import { getEmailConfig } from '@/lib/email-config';
import { authorizePromotion, promotionInternalError } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/promotions/contact
 * Trả về thông tin liên hệ của Spa (thương hiệu, hotline, địa chỉ, website)
 * lấy từ cấu hình SystemConfigs trong cơ sở dữ liệu.
 */
export async function GET() {
    const auth = await authorizePromotion('pass.view');
    if (auth instanceof Response) return auth;

    try {
        const cfg = await getEmailConfig();
        const address = cfg.email_branch_address || cfg.email_branch_name || '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh';
        const hotline = cfg.email_hotline || '+84 964 090 277';
        const brandName = cfg.email_brand_name || 'ORIA SPA';
        const websiteUrl = cfg.email_website_url || 'https://oria-spa.vercel.app';
        const webBookingInstructions = {
            vi: cfg.voucher_webbooking_instruction_vi || 'Vui lòng đặt lịch qua website để áp dụng voucher này.',
            en: cfg.voucher_webbooking_instruction_en || 'Please book through our website to apply this voucher.',
            cn: cfg.voucher_webbooking_instruction_cn || '请通过我们的网站预约以使用此优惠券。',
            jp: cfg.voucher_webbooking_instruction_jp || '当クーポンをご利用の際は、ウェブサイトよりご予約ください。',
            kr: cfg.voucher_webbooking_instruction_kr || '이 바우처를 사용하시려면 웹사이트를 통해 예약해 주세요.',
        };

        return NextResponse.json({
            success: true,
            data: {
                brandName,
                hotline,
                address,
                websiteUrl,
                webBookingInstructions,
            },
        });
    } catch (e) {
        return promotionInternalError(e);
    }
}
