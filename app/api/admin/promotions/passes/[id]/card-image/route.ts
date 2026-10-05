import { getEmailConfig } from '@/lib/email-config';
import { getBrownLogoPng, renderPromotionEmailCardPng } from '@/lib/promotion-email-card';
import { authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';
import { pickPromotionText, pickVoucherLang } from '@/lib/promotion-voucher.i18n';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const png = (buf: Buffer) =>
    new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60' } });

// GET /api/admin/promotions/passes/:id/card-image?lang=en|vi|cn|jp|kr[&part=logo]
// PNG of the e-voucher front (same painter as the email) for the admin print / PDF page.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('pass.view');
    if (auth instanceof Response) return auth;
    try {
        const url = new URL(request.url);
        const cfg = await getEmailConfig();
        if (url.searchParams.get('part') === 'logo') {
            const logo = cfg.email_logo_url ? await getBrownLogoPng(cfg.email_logo_url) : null;
            return logo ? png(logo) : new Response(null, { status: 404 });
        }
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });
        const res = await PromotionEngineService.getPass(id);
        if (!res.success) return promotionJson(res);
        const pass = res.data as typeof res.data & { qrPayload?: string | null };
        if (!pass.qrPayload) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Voucher không còn QR' } });
        const lang = pickVoucherLang(url.searchParams.get('lang'));
        const card = await renderPromotionEmailCardPng({
            lang,
            pass: { ...pass, campaign: { ...pass.campaign, name: pickPromotionText(pass.campaign.name, pass.campaign.nameI18n, lang) } },
            qrPayload: pass.qrPayload,
            conditionsSummary: pass.conditionsSummary,
            brandName: cfg.email_brand_name || 'Spa',
            contact: { hotline: cfg.email_hotline, websiteUrl: cfg.email_website_url, address: cfg.email_branch_address || cfg.email_branch_name },
        });
        return png(card);
    } catch (e) {
        return promotionInternalError(e);
    }
}
