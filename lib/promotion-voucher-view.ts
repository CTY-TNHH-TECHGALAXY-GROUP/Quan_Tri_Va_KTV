import 'server-only';
import { sessionHasPermission } from '@/lib/auth-server';
import { getEmailConfig } from '@/lib/email-config';
import { PROMOTION_SCAN_PATH } from '@/lib/constants/promotion';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import type { PromotionEmailLang, PromotionPublicVoucherDto } from '@/lib/types/promotion';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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
    webBookingInstructions?: Record<PromotionEmailLang, string>;
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
        webBookingInstructions: {
            vi: cfg.voucher_webbooking_instruction_vi || 'Vui lòng đặt lịch qua website để áp dụng voucher này.',
            en: cfg.voucher_webbooking_instruction_en || 'Please book through our website to apply this voucher.',
            cn: cfg.voucher_webbooking_instruction_cn || '请通过我们的网站预约以使用此优惠券。',
            jp: cfg.voucher_webbooking_instruction_jp || '当クーポンをご利用の際は、ウェブサイトよりご予約ください。',
            kr: cfg.voucher_webbooking_instruction_kr || '이 바우처를 사용하시려면 웹사이트를 통해 예약해 주세요.',
        },
    };
    if (!token || token.length > MAX_TOKEN_LENGTH) return { mode: 'INVALID', contact };

    const res = await PromotionEngineService.getPublicVoucher(token);
    if (!res.success) return { mode: 'INVALID', contact };

    // Kiểm tra và áp dụng ghi đè câu hướng dẫn theo Campaign (nếu có)
    const isWebBooking = res.data.conditionsSummary?.conditions?.some(c => c.sources?.includes('WEB_BOOKING'));
    if (isWebBooking) {
        try {
            const supabase = getSupabaseAdmin();
            if (supabase) {
                const { data: passRow } = await supabase
                    .from('CustomerPromotionPasses')
                    .select('campaign_id')
                    .eq('qr_token', token)
                    .single();
                if (passRow?.campaign_id) {
                    const { data: overrideCfg } = await supabase
                        .from('SystemConfigs')
                        .select('value')
                        .eq('key', `voucher_wb_inst_campaign_${passRow.campaign_id}`)
                        .single();
                    if (overrideCfg?.value) {
                        const parsed = typeof overrideCfg.value === 'string' ? JSON.parse(overrideCfg.value) : overrideCfg.value;
                        if (parsed && typeof parsed === 'object') {
                            contact.webBookingInstructions = {
                                ...contact.webBookingInstructions,
                                ...parsed,
                            };
                        }
                    }
                }
            }
        } catch {
            // Không chặn trang nếu tra cứu override gặp sự cố
        }
    }

    return { mode: 'CUSTOMER', voucher: res.data, contact };
}
