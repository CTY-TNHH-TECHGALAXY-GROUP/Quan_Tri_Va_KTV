import type {
    PROMOTION_ASSIGNMENT_MODES,
    PROMOTION_BENEFIT_TYPES,
    PROMOTION_CAMPAIGN_STATUSES,
    PROMOTION_EMAIL_STATUSES,
    PROMOTION_PASS_EFFECTIVE_STATUSES,
    PROMOTION_PASS_STATUSES,
    PROMOTION_QUALIFICATION_TYPES,
    PROMOTION_USAGE_STATUSES,
    PROMOTION_USAGE_TYPES,
    PROMOTION_VALIDITY_TYPES,
} from '@/lib/constants/promotion';

// Server-side DTOs of the Promotion Engine. Shapes match the frontend contract
// (lib/types/promotion-client.ts on feat/promotion-frontend); extra fields are additive.

export type PromotionBenefitType = typeof PROMOTION_BENEFIT_TYPES[number];
export type PromotionUsageType = typeof PROMOTION_USAGE_TYPES[number];
export type PromotionQualificationType = typeof PROMOTION_QUALIFICATION_TYPES[number];
export type PromotionAssignmentMode = typeof PROMOTION_ASSIGNMENT_MODES[number];
export type PromotionCampaignStatus = typeof PROMOTION_CAMPAIGN_STATUSES[number];
export type PromotionPassStatus = typeof PROMOTION_PASS_STATUSES[number];
export type PromotionPassEffectiveStatus = typeof PROMOTION_PASS_EFFECTIVE_STATUSES[number];
export type PromotionUsageStatus = typeof PROMOTION_USAGE_STATUSES[number];
export type PromotionValidityType = typeof PROMOTION_VALIDITY_TYPES[number];
export type PromotionEmailStatus = typeof PROMOTION_EMAIL_STATUSES[number];
export type PromotionEmailLang = 'vi' | 'en' | 'cn' | 'jp' | 'kr';

export interface PromotionError {
    code: string;
    message: string;
    data?: unknown;
}

export type PromotionResult<T> =
    | { success: true; data: T }
    | { success: false; error: PromotionError; data?: T };

/** ISO-8601 string with +07:00 offset. */
export type IsoDateTime = string;

export interface PromotionQualificationConfig {
    serviceIds?: string[];
    serviceIdPrefixes?: string[];
    serviceCategories?: string[];
}

export interface PromotionBenefitConfig {
    /** Cap for PERCENT_DISCOUNT, VND. */
    maxDiscountAmount?: number;
    /** Base for PERCENT_DISCOUNT: whole order (default) or only qualifying items. */
    discountScope?: 'ORDER' | 'QUALIFYING_ITEMS';
}

export interface PromotionCustomerRef {
    id: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
}

export interface PromotionApplyCondition {
    /** Menu codes (service id prefixes), "one of". */
    menus: string[];
    /** Category codes (upper case), "one of". */
    categories: string[];
    /** Service ids, "one of". */
    serviceIds: string[];
    /** Minutes of ONE initial service (vipDuration → duration → Services.duration). */
    minMinutes: number | null;
    /** Paid amount of the order's initial services. */
    minOrderAmount: number | null;
}

export interface PromotionApplyConditions {
    match: 'ALL' | 'ANY';
    conditions: PromotionApplyCondition[];
}

/** Labels resolved for display (menu names, category labels, service names). */
export interface PromotionConditionsSummary {
    match: 'ALL' | 'ANY';
    conditions: { menus: string[]; categories: string[]; services: string[]; minMinutes: number | null; minOrderAmount: number | null }[];
}

export interface PromotionConditionResult {
    met: boolean;
    match: 'ALL' | 'ANY';
    orderAmount: number;
    matchedItemIds: string[];
    matchedAmount: number;
    results: { index: number; met: boolean; matchedItemIds: string[]; bestMinutes: number; minMinutes: number | null; minOrderAmount: number | null; amountMet: boolean }[];
}

export interface PromotionCampaignDto {
    id: string;
    campaignCode: string;
    name: string;
    description: string | null;
    benefit: { type: PromotionBenefitType; value: number; config: PromotionBenefitConfig; serviceId: string | null };
    usage: { type: PromotionUsageType; limit: number | null; maxPerOrder: number; maxPerCustomer: number | null };
    qualification: { type: PromotionQualificationType; value: number | null; config: PromotionQualificationConfig };
    /** Apply conditions — ONE config for apply and auto-issue. */
    applyConditions: PromotionApplyConditions;
    conditionsSummary: PromotionConditionsSummary;
    /** Union of the conditions' criteria (labels). Empty = all menus. */
    applicableMenus: { menus: string[]; categories: string[]; serviceIds: string[]; allMenus: boolean; labels: string[] };
    validity: { type: PromotionValidityType; days: number | null };
    assignmentMode: PromotionAssignmentMode;
    onePassPerCustomer: boolean;
    status: PromotionCampaignStatus;
    validFrom: IsoDateTime;
    validUntil: IsoDateTime;
    voucherPrefix: string;
    benefitServiceId: string | null;
    issuedPassCount: number;
    usageCount: number;
    createdBy: string | null;
    createdAt: IsoDateTime;
    updatedAt: IsoDateTime;
}

export interface PromotionPassDto {
    id: string;
    voucherCode: string;
    /** Value encoded in the e-voucher QR (scan URL). Only on detail / lookup / issue / customer history. */
    qrPayload?: string | null;
    status: PromotionPassStatus;
    effectiveStatus: PromotionPassEffectiveStatus;
    statusReason: string | null;
    campaign: { id: string; name: string; campaignCode: string; status: PromotionCampaignStatus };
    /** Voucher OWNER. The voucher may be used on other customers' orders. */
    customer: PromotionCustomerRef;
    benefit: { type: PromotionBenefitType; value: number; serviceId: string | null };
    usage: { type: PromotionUsageType; limit: number | null; usedCount: number; maxPerOrder: number; lastUsedAt: IsoDateTime | null };
    lastUsedAt: IsoDateTime | null;
    validFrom: IsoDateTime;
    validUntil: IsoDateTime;
    issuedAt: IsoDateTime;
    issueSource: 'AUTO' | 'MANUAL';
    issuedBy: string | null;
    sourceBookingId: string | null;
    emailStatus: PromotionEmailStatus;
    emailTo: string | null;
    emailLang: PromotionEmailLang | null;
    emailSentAt: IsoDateTime | null;
    emailLastError: string | null;
    reminderStatus: 'NONE' | 'SENDING' | 'SENT' | 'FAILED';
    reminderSentAt: IsoDateTime | null;
    /** Set when a new pass replaced this closed one (re-issue). */
    supersededAt: IsoDateTime | null;
    supersededBy: string | null;
    /** When a closed pass ended (cancel / last use / expiry); null while usable. */
    endedAt: IsoDateTime | null;
    /** Apply conditions with labels — exactly what promo_check_apply enforces. */
    conditionsSummary: PromotionConditionsSummary;
}

export interface PromotionOrderItemDto {
    id: string;
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    /** Line total (price × quantity). Negative for discount lines. */
    price: number;
    status: string;
    isPromotion: boolean;
}

export interface PromotionBookingDto {
    id: string;
    billCode: string;
    displayCode: string;
    status: 'NEW' | 'PREPARING' | 'IN_PROGRESS' | string;
    customerId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    bookingTime: string | null;
    roomLabel: string | null;
    totalAmount: number;
    createdAt: IsoDateTime;
    source: string | null;
    items: PromotionOrderItemDto[];
    /** Paid + promotion minutes (server formula). */
    totalDurationMinutes: number;
    paidMinutes: number;
    promotionMinutes: number;
}

export interface PromotionOrderCandidateDto extends PromotionBookingDto {
    isPassOwnerOrder: boolean;
    canApply: boolean;
    blockedReasonCode: string | null;
    blockedReason: string | null;
    /** Per-condition result, e.g. to show "needs VIP from 90 min — order has 60". */
    conditionResult: PromotionConditionResult;
    /** ELIGIBLE; NOT_ELIGIBLE = only conditions missed (counter may override with a reason); BLOCKED = hard block. */
    eligibility: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'BLOCKED';
    canOverride: boolean;
    /** Vietnamese lines for the order note and the confirmation popup. */
    unmetReasons: string[];
    alreadyAppliedThisPass: boolean;
}

export interface PromotionApplyResultDto {
    usageId: string;
    bookingItemId: string;
    appliedMinutes: number;
    discountAmount: number;
    /** true when applied although the conditions were missed (reason recorded). */
    conditionsOverridden: boolean;
    overrideReasons: string[] | null;
    benefit: { type: PromotionBenefitType; value: number; serviceId: string };
    booking: PromotionBookingDto;
    pass: PromotionPassDto;
}

export interface PromotionUsageDto {
    id: string;
    appliedAt: IsoDateTime;
    status: PromotionUsageStatus;
    benefit: { type: PromotionBenefitType; value: number };
    appliedMinutes: number;
    discountAmount: number;
    passId: string;
    voucherCode: string;
    campaignId: string;
    campaignName: string;
    /** Customer of the ORDER. */
    customer: PromotionCustomerRef;
    passOwner: { id: string | null; name: string | null };
    booking: { id: string; billCode: string | null; displayCode: string };
    staffId: string | null;
    staffName: string | null;
    completedAt: IsoDateTime | null;
    cancelledAt: IsoDateTime | null;
    cancelReason: string | null;
    /** Applied as an exception (conditions missed) — staffName / overrideNote say who and why. */
    conditionsOverridden: boolean;
    overrideReasons: string[];
    overrideNote: string | null;
}

export interface PromotionOverviewDto {
    activeCampaigns: number;
    passesIssued: number;
    activePasses: number;
    /** EXPIRED + USED_UP + CANCELLED. */
    pastPasses: number;
    usesThisMonth: number;
}

export interface CustomerPromotionsDto {
    active: PromotionPassDto[];
    past: PromotionPassDto[];
    usages: PromotionUsageDto[];
}

export interface PromotionCustomerSearchDto extends PromotionCustomerRef {
    language: PromotionEmailLang;
}

/** Result of sending (or trying to send) an e-voucher email. */
export interface PromotionEmailOutcome {
    /** QUEUED = not sent within the request budget; the cron sends it within ~5 minutes. */
    status: 'SENT' | 'FAILED' | 'SKIPPED' | 'QUEUED';
    reason?: string;
}

export interface PromotionMenuDto {
    /** Service id prefix, e.g. NHP / NHS / NHT. */
    code: string;
    /** From SystemConfigs.promotion_menu_labels, falls back to the code. */
    label: string;
    serviceCount: number;
    categories: { code: string; label: string; serviceCount: number }[];
    services: { id: string; name: string; category: string | null; categoryCodes: string[] }[];
}

/** Public e-voucher card (VoucherCardData-compatible) for /voucher?t=. */
export interface PromotionPublicVoucherDto {
    campaignName: string;
    benefit: { type: PromotionBenefitType; value: number };
    usage: { type: PromotionUsageType; limit: number | null; maxPerOrder: number; usedCount: number };
    validFrom: IsoDateTime;
    validUntil: IsoDateTime;
    voucherCode: string;
    voucherPrefix: string;
    customerName: string | null;
    status: PromotionPassStatus;
    effectiveStatus: PromotionPassEffectiveStatus;
    applicableMenus: { menus: string[]; categories: string[]; serviceIds: string[]; allMenus: boolean; labels: string[] };
    /** Human names of the scope for the customer page, e.g. ["Menu VIP"]; [] = all menus. */
    menuLabels: string[];
    /** Conditions with resolved labels; format with formatPromotionConditions(). */
    conditionsSummary: PromotionConditionsSummary;
    /** Present while the voucher is usable (ACTIVE / NOT_STARTED). */
    qrPayload: string | null;
}

export interface PromotionCustomerCandidateDto {
    id: string;
    name: string;
    phone: string | null;
    /** Real email only (guest placeholders are null). */
    email: string | null;
    gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
    nationality: string | null;
    language: PromotionEmailLang;
    /** Completed parent bookings. */
    visitCount: number;
    totalSpent: number;
    lastVisitAt: string | null;
    vipMenuCount: number;
    vipMenuUsed: boolean;
    guestType: 'SINGLE' | 'GROUP';
    tier: 'NEW' | 'RETURNING';
    qualifyingOrderCount: number;
    /** Holds a USABLE pass of this campaign → cannot be issued again (row sorted last). */
    alreadyHasPass: boolean;
    /** Every voucher the profile ever had (all campaigns), newest first, max 10. */
    passHistory: { passId: string; voucherCode: string; campaignId: string; campaignName: string; effectiveStatus: PromotionPassEffectiveStatus; issuedAt: IsoDateTime }[];
}

export interface PromotionCustomerCandidatePageDto {
    rows: PromotionCustomerCandidateDto[];
    total: number;
    limit: number;
    offset: number;
    excludedNoEmail: number;
    nationalities: string[];
    qualificationIgnored: boolean;
    qualifyingComputed: boolean;
}

export interface PromotionBulkIssueItemDto {
    customerId: string;
    status: 'ISSUED' | 'ALREADY_EXISTS' | 'FAILED';
    passId?: string;
    voucherCode?: string;
    /** New pass issued after the previous one was cancelled / expired / used up. */
    reissued?: boolean;
    emailDelivery?: PromotionEmailOutcome;
    errorCode?: string;
}

export interface PromotionBulkIssueResultDto {
    results: PromotionBulkIssueItemDto[];
    summary: { issued: number; alreadyExists: number; failed: number; emailSent: number; emailFailed: number; emailSkipped: number; emailQueued: number };
}
