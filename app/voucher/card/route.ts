import { getEmailConfig } from '@/lib/email-config';
import { renderPromotionEmailCardPng } from '@/lib/promotion-email-card';
import { pickPromotionText, pickVoucherLang } from '@/lib/promotion-voucher.i18n';
import type { PromotionPassDto } from '@/lib/types/promotion';
import { notFound, pngResponse, publicVoucherFor } from '../voucher-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /voucher/card?t=<token>&lang= — PNG of the e-voucher front, linked from the email
// (no attachment). Same token and data as /voucher?t=; unknown token → 404.
export async function GET(request: Request) {
    try {
        const found = await publicVoucherFor(request);
        if (!found) return notFound();
        const { token, voucher: v } = found;
        const lang = pickVoucherLang(new URL(request.url).searchParams.get('lang'));
        const cfg = await getEmailConfig();
        // Used / expired vouchers have no QR payload: point the card QR at the voucher page.
        const qr = v.qrPayload ?? `${new URL(request.url).origin}/voucher?t=${encodeURIComponent(token)}`;
        const pass = {
            voucherCode: v.voucherCode,
            campaign: { name: pickPromotionText(v.campaignName, v.campaignNameI18n, lang) },
            customer: { name: v.customerName },
            benefit: v.benefit,
            usage: v.usage,
            validUntil: v.validUntil,
        } as unknown as PromotionPassDto;
        const png = await renderPromotionEmailCardPng({
            lang,
            pass,
            qrPayload: qr,
            conditionsSummary: v.conditionsSummary,
            brandName: cfg.email_brand_name || 'Spa',
            contact: { hotline: cfg.email_hotline, websiteUrl: cfg.email_website_url, address: cfg.email_branch_address || cfg.email_branch_name },
        });
        return pngResponse(png);
    } catch (e) {
        console.error('[voucher/card]', (e as Error)?.message);
        return notFound();
    }
}
