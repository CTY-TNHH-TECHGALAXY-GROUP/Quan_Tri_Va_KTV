import 'server-only';
import { sessionHasPermission } from '@/lib/auth-server';
import { getEmailConfig } from '@/lib/email-config';
import { PROMOTION_SCAN_PATH } from '@/lib/constants/promotion';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import type { PromotionPublicVoucherDto } from '@/lib/types/promotion';

/**
 * Server-side resolver for the public e-voucher page `/voucher?t=<token>`
 * (the URL encoded in the QR on the 3D e-voucher and in the email).
 *
 *  - Staff with `dispatch_board` → redirect to the reception scanner with the same token.
 *  - Anyone else → card data + spa contact, so the page shows the e-voucher and
 *    "please contact the spa to apply" (PROMOTION_VOUCHER_PAGE_I18N).
 *  - Unknown token → INVALID (page shows "voucher không hợp lệ", nothing else).
 *
 * Usage in the page (Server Component):
 *   const view = await resolveVoucherView(searchParams.t);
 *   if (view.mode === 'STAFF') redirect(view.redirectTo);
 */
export type VoucherView =
    | { mode: 'STAFF'; redirectTo: string }
    | { mode: 'CUSTOMER'; voucher: PromotionPublicVoucherDto; contact: VoucherContact }
    | { mode: 'INVALID'; contact: VoucherContact };

export interface VoucherContact {
    brandName: string;
    logoUrl: string | null;
    hotline: string | null;
    address: string | null;
    websiteUrl: string | null;
}

const MAX_TOKEN_LENGTH = 200;

export async function resolveVoucherView(rawToken: string | string[] | undefined | null): Promise<VoucherView> {
    const token = (Array.isArray(rawToken) ? rawToken[0] : rawToken)?.trim() || '';
    if (token && token.length <= MAX_TOKEN_LENGTH && await sessionHasPermission('dispatch_board')) {
        return { mode: 'STAFF', redirectTo: `${PROMOTION_SCAN_PATH}?t=${encodeURIComponent(token)}` };
    }

    const cfg = await getEmailConfig();
    const contact: VoucherContact = {
        brandName: cfg.email_brand_name || 'Spa',
        logoUrl: cfg.email_logo_url || null,
        hotline: cfg.email_hotline || null,
        address: cfg.email_branch_address || cfg.email_branch_name || null,
        websiteUrl: cfg.email_website_url || null,
    };
    if (!token || token.length > MAX_TOKEN_LENGTH) return { mode: 'INVALID', contact };

    const res = await PromotionEngineService.getPublicVoucher(token);
    if (!res.success) return { mode: 'INVALID', contact };
    return { mode: 'CUSTOMER', voucher: res.data, contact };
}
