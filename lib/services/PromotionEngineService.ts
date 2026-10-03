import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { displayBookingCode } from '@/lib/booking-display-code';
import { PROMOTION_VOUCHER_PATH } from '@/lib/constants/promotion';
import { expandPromotionDate } from '@/lib/schemas/promotion.schema';
import type {
    CustomerPromotionsDto,
    PromotionApplyResultDto,
    PromotionBookingDto,
    PromotionCampaignDto,
    PromotionCustomerSearchDto,
    PromotionCustomerCandidatePageDto,
    PromotionMenuDto,
    PromotionPublicVoucherDto,
    PromotionOrderCandidateDto,
    PromotionOverviewDto,
    PromotionPassDto,
    PromotionResult,
    PromotionUsageDto,
} from '@/lib/types/promotion';
import type { CreatePromotionCampaignInput, UpdatePromotionCampaignInput } from '@/lib/schemas/promotion.schema';

/**
 * Promotion Engine — thin TS facade over the promo_* RPCs
 * (supabase/migrations/20261002120000_promotion_engine.sql + 20261002180000_promotion_engine_v2.sql).
 *
 * Every rule (eligibility, paid qualifying minutes, canApply, usage limits,
 * validity, expiry, voucher/QR generation) lives in SQL so the pg_cron
 * auto-complete path, this app, wrb-noi-bo and Web Booking share one source.
 * This file only maps transport details: date-only inputs, display codes, QR payload URL.
 */

const CAMPAIGN_KEY_MAP: Record<keyof CreatePromotionCampaignInput, string> = {
    campaignCode: 'campaign_code',
    name: 'name',
    description: 'description',
    benefitType: 'benefit_type',
    benefitValue: 'benefit_value',
    benefitConfig: 'benefit_config',
    validFrom: 'valid_from',
    validUntil: 'valid_until',
    usageType: 'usage_type',
    usageLimit: 'usage_limit',
    maxUsagePerCustomer: 'max_usage_per_customer',
    maxUsagePerOrder: 'max_usage_per_order',
    qualificationType: 'qualification_type',
    qualificationValue: 'qualification_value',
    qualificationConfig: 'qualification_config',
    assignmentMode: 'assignment_mode',
    onePassPerCustomer: 'one_pass_per_customer',
    voucherPrefix: 'voucher_prefix',
    validityType: 'validity_type',
    validityDays: 'validity_days',
    serviceNameVN: 'service_name_vn',
    serviceNameEN: 'service_name_en',
    applicableMenus: 'qualification_config',
    applyConditions: 'apply_conditions',
};

const toRpcPayload = (input: Partial<CreatePromotionCampaignInput>) => {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
        if (raw === undefined) continue;
        const mapped = CAMPAIGN_KEY_MAP[key as keyof CreatePromotionCampaignInput];
        if (!mapped) continue;
        let value = raw;
        if (key === 'validFrom' && typeof raw === 'string') value = expandPromotionDate(raw, 'start');
        if (key === 'validUntil' && typeof raw === 'string') value = expandPromotionDate(raw, 'end');
        if (key === 'applicableMenus') {
            // One menu scope drives qualification, where the voucher applies and the % discount base.
            const m = (raw ?? {}) as { menus?: string[]; categories?: string[]; serviceIds?: string[] };
            value = {
                serviceIdPrefixes: (m.menus ?? []).map(x => x.toUpperCase()),
                serviceCategories: (m.categories ?? []).map(x => x.toUpperCase()),
                serviceIds: m.serviceIds ?? [],
            };
        }
        out[mapped] = value;
    }
    return out;
};

const scanBaseUrl = () =>
    (process.env.PROMOTION_SCAN_BASE_URL || process.env.APP_URL || '').replace(/\/+$/, '');

/**
 * QR payload of the e-voucher: public /voucher?t=<opaque token> page.
 * Staff opening it are redirected to the reception scanner; anyone else sees the card.
 */
export const buildPromotionQrPayload = (qrToken: string | null | undefined) =>
    qrToken ? `${scanBaseUrl()}${PROMOTION_VOUCHER_PATH}?t=${encodeURIComponent(qrToken)}` : null;

type RawPass = PromotionPassDto & { qrToken?: string | null };

/** Replace the raw token with the QR payload; `withQr=false` strips it entirely (list rows). */
export const mapPass = (pass: RawPass | null | undefined, withQr: boolean): PromotionPassDto => {
    const { qrToken, ...rest } = (pass ?? {}) as RawPass;
    return withQr ? { ...rest, qrPayload: buildPromotionQrPayload(qrToken) } : rest;
};

const mapBooking = <T extends Omit<PromotionBookingDto, 'displayCode'>>(b: T) =>
    ({ ...b, displayCode: displayBookingCode(b.billCode) });

const mapUsage = (u: PromotionUsageDto): PromotionUsageDto => ({
    ...u,
    booking: { ...u.booking, displayCode: displayBookingCode(u.booking.billCode) },
});

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<PromotionResult<T>> {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Supabase admin not initialized' } };
    }
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
        console.error(`[PromotionEngine] ${fn} failed:`, error.message);
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
    const res = data as PromotionResult<T> & { data?: unknown };
    // Conflicts carry the existing entity at top level; the client contract reads it from error.data.
    if (res && !res.success && res.data !== undefined && res.error && res.error.data === undefined) {
        return { success: false, error: { ...res.error, data: res.data } };
    }
    return res;
}

const mapResult = <T, U>(res: PromotionResult<T>, fn: (d: T) => U): PromotionResult<U> =>
    res.success ? { success: true, data: fn(res.data) } : (res as PromotionResult<U>);

export const PromotionEngineService = {
    // --- Campaigns (admin) ---
    listCampaigns: (status?: string) =>
        callRpc<PromotionCampaignDto[]>('promo_list_campaigns', { p_status: status ?? null }),

    getCampaign: async (campaignId: string): Promise<PromotionResult<PromotionCampaignDto>> => {
        const supabase = getSupabaseAdmin();
        if (!supabase) return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Supabase admin not initialized' } };
        const { data, error } = await supabase.rpc('promo_campaign_json', { p_campaign_id: campaignId });
        if (error) return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
        if (!data) return { success: false, error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Không tìm thấy chương trình' } };
        return { success: true, data: data as PromotionCampaignDto };
    },

    createCampaign: (input: CreatePromotionCampaignInput, staffId: string | null) =>
        callRpc<PromotionCampaignDto>('promo_create_campaign', { p_payload: toRpcPayload(input), p_staff_id: staffId }),

    updateCampaign: (campaignId: string, input: UpdatePromotionCampaignInput, staffId: string | null) =>
        callRpc<PromotionCampaignDto>('promo_update_campaign', {
            p_campaign_id: campaignId, p_payload: toRpcPayload(input), p_staff_id: staffId,
        }),

    setCampaignStatus: (campaignId: string, action: string, staffId: string | null) =>
        callRpc<PromotionCampaignDto>('promo_set_campaign_status', { p_campaign_id: campaignId, p_action: action, p_staff_id: staffId }),

    getOverview: () => callRpc<PromotionOverviewDto>('promo_overview', {}),

    /** Live menu / category / service catalogue for the campaign form (no hard-coded menus). */
    getMenuCatalog: () => callRpc<PromotionMenuDto[]>('promo_menu_catalog', {}),

    /** Card data for the public /voucher?t= page. No phone / email / orders. */
    getPublicVoucher: async (qrToken: string) =>
        mapResult(await callRpc<Omit<PromotionPublicVoucherDto, 'qrPayload'> & { qrToken?: string | null }>(
            'promo_public_voucher_by_token', { p_qr_token: qrToken }),
            ({ qrToken: t, ...rest }) => ({ ...rest, qrPayload: buildPromotionQrPayload(t) })),

    // --- Passes ---
    searchPasses: async (filter: { q?: string | null; campaignId?: string | null; status?: string | null; expiry?: string | null; group?: string | null; limit?: number; offset?: number }) =>
        mapResult(await callRpc<{ total: number; items: RawPass[] }>('promo_search_passes', {
            p_q: filter.q ?? null, p_campaign_id: filter.campaignId ?? null, p_status: filter.status ?? null,
            p_expiry: filter.expiry ?? null, p_limit: filter.limit ?? 100, p_offset: filter.offset ?? 0,
            p_group: filter.group ?? null,
        }), d => ({ total: d.total, items: d.items.map(p => mapPass(p, false)) })),

    getPass: async (passId: string): Promise<PromotionResult<PromotionPassDto>> => {
        const supabase = getSupabaseAdmin();
        if (!supabase) return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Supabase admin not initialized' } };
        const { data, error } = await supabase.rpc('promo_pass_json', { p_pass_id: passId, p_include_token: true });
        if (error) return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
        if (!data) return { success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } };
        return { success: true, data: mapPass(data as RawPass, true) };
    },

    issueManual: async (campaignId: string, customerId: string, staffId: string | null) => {
        const res = await callRpc<RawPass>('promo_issue_manual', {
            p_campaign_id: campaignId, p_customer_id: customerId, p_staff_id: staffId,
        });
        if (!res.success && res.error.data) {
            return { success: false as const, error: { ...res.error, data: mapPass(res.error.data as RawPass, true) } };
        }
        return mapResult(res, p => mapPass(p, true));
    },

    setPassStatus: async (passId: string, action: string, reason: string | null, staffId: string | null) =>
        mapResult(await callRpc<RawPass>('promo_set_pass_status', {
            p_pass_id: passId, p_action: action, p_reason: reason, p_staff_id: staffId,
        }), p => mapPass(p, false)),

    /** Scan result (includes the QR payload — the scanner already holds the token). */
    lookupPass: async (query: { qrToken?: string | null; voucherCode?: string | null }) => {
        const res = await callRpc<RawPass>('promo_lookup_pass', {
            p_qr_token: query.qrToken ?? null, p_voucher_code: query.voucherCode ?? null,
        });
        if (!res.success) return res;
        // promo_lookup_pass returns the pass without token; re-read with token for qrPayload.
        return PromotionEngineService.getPass(res.data.id);
    },

    getOrderCandidates: async (passId: string, q?: string | null) =>
        mapResult(await callRpc<Omit<PromotionOrderCandidateDto, 'displayCode'>[]>('promo_order_candidates', {
            p_pass_id: passId, p_q: q ?? null, p_limit: 50,
        }), rows => rows.map(mapBooking)),

    listUsages: async (filter: { from?: string | null; to?: string | null; campaignId?: string | null; status?: string | null; q?: string | null; passId?: string | null; overridden?: boolean | null }) =>
        mapResult(await callRpc<PromotionUsageDto[]>('promo_list_usages', {
            p_from: filter.from ?? null, p_to: filter.to ?? null, p_campaign_id: filter.campaignId ?? null,
            p_status: filter.status ?? null, p_q: filter.q ?? null, p_pass_id: filter.passId ?? null, p_limit: 500,
            p_overridden: filter.overridden ?? null,
        }), rows => rows.map(mapUsage)),

    searchCustomers: (q: string) =>
        callRpc<PromotionCustomerSearchDto[]>('promo_search_customers', { p_q: q, p_limit: 20 }),

    getCustomerPromotions: async (customerId: string) =>
        mapResult(await callRpc<CustomerPromotionsDto>('promo_customer_promotions', { p_customer_id: customerId }), d => ({
            active: d.active.map(p => mapPass(p as RawPass, true)),
            past: d.past.map(p => mapPass(p as RawPass, false)),
            usages: d.usages.map(mapUsage),
        })),

    // --- Customer profile filter + bulk issue ---
    getCustomerCandidates: (campaignId: string, filter: Record<string, unknown>, limit: number, offset: number) =>
        callRpc<PromotionCustomerCandidatePageDto>('promo_customer_candidates', {
            p_campaign_id: campaignId, p_filter: filter, p_limit: limit, p_offset: offset,
        }),

    issueBulk: (campaignId: string, customerIds: string[], staffId: string | null) =>
        callRpc<{ results: { customerId: string; status: 'ISSUED' | 'ALREADY_EXISTS' | 'FAILED'; passId?: string; voucherCode?: string; emailStatus?: string; reissued?: boolean; errorCode?: string }[] }>(
            'promo_issue_bulk', { p_campaign_id: campaignId, p_customer_ids: customerIds, p_staff_id: staffId }),

    // --- Order integration ---
    applyPassToOrder: async (passId: string, bookingId: string, staffId: string | null,
                             override?: { conditions?: boolean; note?: string | null }) =>
        mapResult(await callRpc<Omit<PromotionApplyResultDto, 'booking'> & { booking: Omit<PromotionBookingDto, 'displayCode'> }>(
            'promo_apply_pass', {
                p_pass_id: passId, p_booking_id: bookingId, p_staff_id: staffId,
                p_override_conditions: override?.conditions ?? false, p_override_note: override?.note ?? null,
            },
        ), d => ({ ...d, booking: mapBooking(d.booking), pass: mapPass(d.pass as RawPass, false) })),

    cancelUsage: (usageId: string, staffId: string | null, reason: string | null) =>
        callRpc<{ usageId: string; status: 'CANCELLED' }>('promo_cancel_usage', {
            p_usage_id: usageId, p_staff_id: staffId, p_reason: reason,
        }),

    // --- Email outbox (used by PromotionEmailService) ---
    claimPassEmail: (passId: string, kind: 'ISSUE' | 'REMINDER', force: boolean) =>
        callRpc<{ passId: string; kind: 'ISSUE' | 'REMINDER'; to: string; lang: string; pass: RawPass; campaignDescription: string | null; skipped?: boolean; reason?: string }>(
            'promo_claim_pass_email', { p_pass_id: passId, p_kind: kind, p_force: force }),

    claimEmailBatch: (limit: number) =>
        callRpc<{ passId: string; kind: 'ISSUE' | 'REMINDER'; to: string; lang: string; pass: RawPass; campaignDescription: string | null }[]>(
            'promo_claim_email_batch', { p_limit: limit }),

    markEmailResult: (passId: string, kind: 'ISSUE' | 'REMINDER', ok: boolean, error: string | null) =>
        callRpc<RawPass>('promo_mark_email_result', { p_pass_id: passId, p_kind: kind, p_ok: ok, p_error: error }),

    reminderDays: async () => {
        const supabase = getSupabaseAdmin();
        const { data } = await supabase!.rpc('promo_setting_int', { p_key: 'promotion_expiry_reminder_days', p_default: 3 });
        return Number(data) || 3;
    },
};
