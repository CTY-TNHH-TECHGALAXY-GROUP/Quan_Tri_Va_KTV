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

        return NextResponse.json({
            success: true,
            data: {
                brandName,
                hotline,
                address,
                websiteUrl,
            },
        });
    } catch (e) {
        return promotionInternalError(e);
    }
}
