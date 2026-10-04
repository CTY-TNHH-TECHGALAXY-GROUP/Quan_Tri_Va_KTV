import { z } from 'zod';
import {
    PROMOTION_ASSIGNMENT_MODES,
    PROMOTION_CAMPAIGN_ACTIONS,
    PROMOTION_PASS_ACTIONS,
    PROMOTION_QUALIFICATION_TYPES,
    PROMOTION_SUPPORTED_BENEFIT_TYPES,
    PROMOTION_USAGE_TYPES,
    PROMOTION_VALIDITY_TYPES,
} from '@/lib/constants/promotion';

// Request bodies are camelCase; PromotionEngineService maps them to the RPC payload.
// The DB re-checks every rule (CHECK constraints + promo_* RPCs) — this is the friendly first pass.

// Accepts a VN calendar date (yyyy-MM-dd, as sent by the admin form) or a full ISO with offset.
// Dates are expanded by PromotionEngineService (validFrom → 00:00:00+07:00, validUntil → 23:59:59+07:00).
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrIso = z.string().trim().refine(
    v => (DATE_ONLY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00+07:00`)))
        || (/([+-]\d{2}:\d{2}|Z)$/.test(v) && !Number.isNaN(Date.parse(v))),
    { message: 'Ngày phải là yyyy-MM-dd hoặc ISO có múi giờ' },
);

/** yyyy-MM-dd → VN start/end of day; ISO strings pass through. */
export const expandPromotionDate = (v: string, edge: 'start' | 'end') =>
    DATE_ONLY_RE.test(v) ? `${v}T${edge === 'start' ? '00:00:00' : '23:59:59'}+07:00` : v;

const qualificationConfig = z.object({
    serviceIds: z.array(z.string().min(1)).optional(),
    serviceIdPrefixes: z.array(z.string().min(1)).optional(),
    serviceCategories: z.array(z.string().min(1)).optional(),
}).strict();

/** Admin picks menus / categories / single services from GET /api/admin/promotions/menus. Empty = every menu. */
const applicableMenus = z.object({
    menus: z.array(z.string().trim().min(1)).optional(),
    categories: z.array(z.string().trim().min(1)).optional(),
    serviceIds: z.array(z.string().trim().min(1)).optional(),
}).strict();

/**
 * Apply conditions (also used for auto-issue). Each condition = AND of the criteria it sets,
 * each list = "one of"; ONE initial service must satisfy them. Conditions combine with ALL / ANY.
 */
const applyCondition = z.object({
    menus: z.array(z.string().trim().min(1)).max(50).optional(),
    categories: z.array(z.string().trim().min(1)).max(50).optional(),
    serviceIds: z.array(z.string().trim().min(1)).max(200).optional(),
    minMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    minOrderAmount: z.number().nonnegative().nullable().optional(),
}).strict().refine(c => (c.menus?.length || c.categories?.length || c.serviceIds?.length || c.minMinutes || c.minOrderAmount != null), {
    message: 'Mỗi điều kiện cần ít nhất một tiêu chí',
});
const applyConditions = z.object({
    match: z.enum(['ALL', 'ANY']).default('ALL'),
    conditions: z.array(applyCondition).max(10),
}).strict();

const benefitConfig = z.object({
    maxDiscountAmount: z.number().positive().optional(),
    discountScope: z.enum(['ORDER', 'QUALIFYING_ITEMS']).optional(),
}).strict();

/** Optional translations of the English name / description; empty strings are dropped by the DB. */
const textI18n = (max: number) => z.object({
    vi: z.string().max(max).optional(),
    cn: z.string().max(max).optional(),
    jp: z.string().max(max).optional(),
    kr: z.string().max(max).optional(),
}).strict();

const campaignFields = {
    campaignCode: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, 'Mã chương trình 3–40 ký tự (chữ, số, _ -)'),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    nameI18n: textI18n(120).optional(),
    descriptionI18n: textI18n(2000).optional(),
    validityType: z.enum(PROMOTION_VALIDITY_TYPES).optional(),
    validityDays: z.number().int().min(1).max(3650).nullable().optional(),
    benefitType: z.enum(PROMOTION_SUPPORTED_BENEFIT_TYPES),
    benefitValue: z.number().positive(),
    benefitConfig: benefitConfig.nullable().optional(),
    validFrom: dateOrIso,
    validUntil: dateOrIso,
    usageType: z.enum(PROMOTION_USAGE_TYPES).optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    maxUsagePerCustomer: z.number().int().positive().nullable().optional(),
    maxUsagePerOrder: z.number().int().positive().optional(),
    qualificationType: z.enum(PROMOTION_QUALIFICATION_TYPES).optional(),
    qualificationValue: z.number().nonnegative().nullable().optional(),
    qualificationConfig: qualificationConfig.nullable().optional(),
    applicableMenus: applicableMenus.nullable().optional(),
    applyConditions: applyConditions.nullable().optional(),
    assignmentMode: z.enum(PROMOTION_ASSIGNMENT_MODES).optional(),
    onePassPerCustomer: z.boolean().optional(),
    voucherPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'Prefix 2–10 ký tự A–Z, 0–9').or(z.literal('')).optional(),
    serviceNameVN: z.string().trim().min(1).max(120).optional(),
    serviceNameEN: z.string().trim().min(1).max(120).optional(),
};

// No .default() here: defaults are applied by the DB on create, and an update
// must only carry the keys the caller sent (rule keys lock once ACTIVE).
const CampaignBase = z.object(campaignFields).strict();

type CampaignShape = Partial<z.infer<typeof CampaignBase>>;

const refineCampaign = (v: CampaignShape, ctx: z.RefinementCtx) => {
    const from = typeof v.validFrom === 'string' ? Date.parse(expandPromotionDate(v.validFrom, 'start')) : NaN;
    const until = typeof v.validUntil === 'string' ? Date.parse(expandPromotionDate(v.validUntil, 'end')) : NaN;
    if (!Number.isNaN(from) && !Number.isNaN(until) && until <= from) {
        ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'validUntil phải sau validFrom' });
    }
    const value = v.benefitValue;
    if (v.benefitType === 'PERCENT_DISCOUNT' && value !== undefined && value > 100) {
        ctx.addIssue({ code: 'custom', path: ['benefitValue'], message: 'Phần trăm giảm tối đa 100' });
    }
    if (v.benefitType === 'FREE_MINUTES' && value !== undefined && !Number.isInteger(value)) {
        ctx.addIssue({ code: 'custom', path: ['benefitValue'], message: 'Số phút phải là số nguyên' });
    }
    if (v.usageType === 'LIMITED' && !v.usageLimit) {
        ctx.addIssue({ code: 'custom', path: ['usageLimit'], message: 'LIMITED cần usageLimit' });
    }
    if (v.validityType === 'DAYS_FROM_ISSUE' && !v.validityDays) {
        ctx.addIssue({ code: 'custom', path: ['validityDays'], message: 'Hiệu lực theo ngày cần validityDays' });
    }
    const qType = v.qualificationType;
    if ((qType === 'MIN_PAID_DURATION' || qType === 'MIN_ORDER_AMOUNT') && (v.qualificationValue === undefined || v.qualificationValue === null)) {
        ctx.addIssue({ code: 'custom', path: ['qualificationValue'], message: 'Cần qualificationValue' });
    }
    if (v.assignmentMode === 'AUTO' && v.applyConditions && v.applyConditions.conditions.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['applyConditions'], message: 'Phát tự động cần ít nhất một điều kiện' });
    }
    if (v.assignmentMode === 'AUTO' && !v.applyConditions && (qType === 'MANUAL_ASSIGNMENT' || qType === 'CUSTOM')) {
        ctx.addIssue({ code: 'custom', path: ['assignmentMode'], message: 'AUTO cần điều kiện tự động (MIN_PAID_DURATION, MIN_ORDER_AMOUNT, SPECIFIC_SERVICE)' });
    }
};

export const CreatePromotionCampaignSchema = CampaignBase.superRefine(refineCampaign);
export type CreatePromotionCampaignInput = z.infer<typeof CreatePromotionCampaignSchema>;

export const UpdatePromotionCampaignSchema = CampaignBase.partial().superRefine(refineCampaign);
export type UpdatePromotionCampaignInput = z.infer<typeof UpdatePromotionCampaignSchema>;
export const PromotionCampaignStatusSchema = z.object({ action: z.enum(PROMOTION_CAMPAIGN_ACTIONS) }).strict();

export const IssuePromotionPassSchema = z.object({
    campaignId: z.string().uuid(),
    customerId: z.string().trim().min(1),
    /** Send the e-voucher email right away (default true). */
    sendEmail: z.boolean().optional(),
}).strict();

export const PromotionPassStatusSchema = z.object({
    action: z.enum(PROMOTION_PASS_ACTIONS),
    reason: z.string().max(500).optional(),
}).strict();

export const ApplyPromotionPassSchema = z.object({
    bookingId: z.string().trim().min(1),
    /** Apply although the order misses the apply conditions (counter confirmed). Hard blocks still apply. */
    overrideConditions: z.boolean().optional(),
    /** Mandatory (3–500 chars) when overriding — checked again server-side. */
    overrideNote: z.string().trim().max(500).optional(),
}).strict();

export const CancelPromotionUsageSchema = z.object({
    reason: z.string().max(500).optional(),
}).strict();
