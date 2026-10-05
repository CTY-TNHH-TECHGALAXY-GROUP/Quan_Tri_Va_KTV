/**
 * Promotion types as seen by the FRONTEND (admin pages + reception scanner).
 *
 * Mirrors the Promotion Engine contract v2 of Agent A
 * (`plans/promotion_engine_api_contract.md`, `lib/types/promotion.ts` on
 * branch `feat/promotion-engine`). Enum values match the DB CHECKs.
 *
 * The UI only renders these fields. Eligibility, minutes, discounts, usage
 * counters, effective status and voucher codes / QR tokens all come from the server.
 */

// Apply conditions are owned by the engine (Agent A, contract v7 §2.2): reuse its types, never redefine.
import type { PromotionApplyCondition, PromotionApplyConditions, PromotionConditionsSummary, PromotionMenuDto, PromotionOrderChannel, PromotionTextI18n } from '@/lib/types/promotion';
export type { PromotionApplyCondition, PromotionApplyConditions, PromotionConditionsSummary, PromotionOrderChannel, PromotionTextI18n };
export { PROMOTION_ORDER_CHANNELS } from '@/lib/types/promotion';

export type PromotionBenefitType =
  | 'FREE_MINUTES'
  | 'PERCENT_DISCOUNT'
  | 'FIXED_DISCOUNT'
  | 'FREE_SERVICE'
  | 'FREE_UPGRADE';

export type PromotionUsageType = 'ONE_TIME' | 'LIMITED' | 'UNLIMITED';

export type PromotionValidityType = 'CAMPAIGN_PERIOD' | 'DAYS_FROM_ISSUE';

export type PromotionQualificationType =
  | 'MIN_PAID_DURATION'
  | 'MIN_ORDER_AMOUNT'
  | 'SPECIFIC_SERVICE'
  | 'MANUAL_ASSIGNMENT'
  | 'CUSTOM';

export type PromotionAssignmentMode = 'AUTO' | 'SPECIFIC_CUSTOMER' | 'CUSTOMER_GROUP' | 'MANUAL_ONLY';

export type PromotionCampaignStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ENDED';

/** Stored status. */
export type PromotionPassStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

/** Computed by the server (stored status + campaign + now). Use this for UI and filters. */
export type PromotionPassEffectiveStatus = 'ACTIVE' | 'NOT_STARTED' | 'INACTIVE' | 'EXPIRED' | 'USED_UP' | 'SUSPENDED' | 'CANCELLED';

export type PromotionEmailStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export type PromotionEmailLang = 'vi' | 'en' | 'cn' | 'jp' | 'kr';

export type PromotionUsageStatus = 'APPLIED' | 'COMPLETED' | 'CANCELLED';

/** Bookings.status values that still accept a promotion (OPEN / CONFIRMED / IN_SERVICE). */
export type PromotionOrderStatus = 'NEW' | 'PREPARING' | 'IN_PROGRESS';

export type CampaignStatusAction = 'ACTIVATE' | 'DEACTIVATE' | 'END';

export type PassStatusAction = 'SUSPEND' | 'CANCEL' | 'REACTIVATE';

export interface PromotionBenefit {
  type: PromotionBenefitType;
  /** Minutes for FREE_MINUTES, % for PERCENT_DISCOUNT, VND for FIXED_DISCOUNT. */
  value: number;
}

export interface PromotionBenefitConfig {
  /** Cap for PERCENT_DISCOUNT, VND. */
  maxDiscountAmount?: number;
}

export interface PromotionUsageRule {
  type: PromotionUsageType;
  /** Total uses allowed when type = LIMITED (null otherwise). */
  limit: number | null;
  usedCount: number;
  maxPerOrder: number;
}

/** Menu scope of a campaign. Empty / allMenus = every menu. */
export interface PromotionApplicableMenus {
  menus: string[];
  categories: string[];
  serviceIds: string[];
  allMenus: boolean;
}

export interface PromotionCampaign {
  id: string;
  campaignCode: string;
  /** English (base) text; translations in nameI18n / descriptionI18n (v12). */
  name: string;
  description: string | null;
  nameI18n?: PromotionTextI18n;
  descriptionI18n?: PromotionTextI18n;
  benefit: PromotionBenefit & { config?: PromotionBenefitConfig; serviceId?: string | null };
  usage: Omit<PromotionUsageRule, 'usedCount'> & { maxPerCustomer?: number | null };
  qualification: {
    type: PromotionQualificationType;
    value: number | null;
    /** Server-side config (prefixes / categories); displayed read-only. */
    config: Record<string, unknown> | null;
  };
  applicableMenus?: PromotionApplicableMenus;
  /** v7: ONE config for apply + auto issue. Replaces applicableMenus / qualification in the form. */
  applyConditions?: PromotionApplyConditions;
  /** Same conditions with labels, for display (formatPromotionConditions). */
  conditionsSummary?: PromotionConditionsSummary;
  validity?: { type: PromotionValidityType; days: number | null };
  assignmentMode: PromotionAssignmentMode;
  status: PromotionCampaignStatus;
  validFrom: string;
  validUntil: string;
  voucherPrefix: string;
  /** Optional aggregates — the UI hides the column when null. */
  issuedPassCount: number | null;
  usageCount: number | null;
  createdAt: string;
}

/** Body of POST / PATCH campaign. Strict on the server: never add unknown keys. */
/** Exact e-voucher email for a pass (admin preview, nothing is sent). */
export interface PromotionEmailPreview {
  lang: PromotionEmailLang;
  from: string;
  replyTo: string;
  to: string | null;
  subject: string;
  html: string;
}

export interface CampaignFormInput {
  /** English — required; shown when a language has no translation. */
  name: string;
  campaignCode: string;
  description: string;
  /** Optional translations (vi / cn / jp / kr). */
  nameI18n: PromotionTextI18n;
  descriptionI18n: PromotionTextI18n;
  benefitType: PromotionBenefitType;
  benefitValue: number | null;
  benefitConfig: PromotionBenefitConfig | null;
  validFrom: string; // yyyy-MM-dd (VN date)
  validUntil: string; // yyyy-MM-dd (VN date)
  validityType: PromotionValidityType;
  validityDays: number | null;
  usageType: PromotionUsageType;
  usageLimit: number | null;
  maxUsagePerOrder: number;
  /** v7 §2.2. Empty list = any order. Wins over any legacy qualification field on the server. */
  applyConditions: PromotionApplyConditions;
  assignmentMode: PromotionAssignmentMode;
  voucherPrefix: string;
}

/** Menu catalogue for the conditions editor (engine GET /menus). */
export type PromotionMenu = PromotionMenuDto;

/** Spa contact printed on the e-voucher (same data as Agent A `VoucherContact`, from the email config). */
export interface SpaContact {
  brandName: string;
  hotline: string | null;
  address: string | null;
  websiteUrl: string | null;
}

export interface PromotionCustomerRef {
  id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface PromotionPass {
  id: string;
  voucherCode: string;
  status: PromotionPassStatus;
  effectiveStatus: PromotionPassEffectiveStatus;
  statusReason: string | null;
  campaign: { id: string; name: string; nameI18n?: PromotionTextI18n; campaignCode: string; status?: PromotionCampaignStatus };
  /** Voucher OWNER. The voucher may be used on other customers' orders. */
  customer: PromotionCustomerRef;
  benefit: PromotionBenefit;
  usage: PromotionUsageRule;
  validFrom: string;
  validUntil: string;
  issuedAt: string;
  issueSource: 'AUTO' | 'MANUAL';
  issuedBy?: string | null;
  lastUsedAt: string | null;
  sourceBookingId: string | null;
  emailStatus?: PromotionEmailStatus;
  emailTo?: string | null;
  emailSentAt?: string | null;
  emailLastError?: string | null;
  /** When a closed pass ended (cancel / last use / expiry); null while usable. */
  endedAt?: string | null;
  /** Apply conditions with labels — exactly what the engine enforces (v7). */
  conditionsSummary?: PromotionConditionsSummary;
  /** Set when a new pass replaced this closed one (re-issue). */
  supersededAt?: string | null;
}

/** Only returned by the detail / lookup / issue endpoints, never in list rows. */
export interface PromotionPassWithQr extends PromotionPass {
  /** Opaque value encoded in the QR (an URL) — produced by the server. */
  qrPayload: string;
}

export interface PromotionEmailOutcome {
  /** QUEUED: not sent within the request, the cron sends it within ~5 minutes. */
  status: 'SENT' | 'FAILED' | 'SKIPPED' | 'QUEUED';
  reason?: string;
}

export interface IssuedPass extends PromotionPassWithQr {
  emailDelivery?: PromotionEmailOutcome;
}

export interface PromotionUsageRecord {
  id: string;
  appliedAt: string;
  status: PromotionUsageStatus;
  benefit: PromotionBenefit;
  appliedMinutes: number | null;
  discountAmount?: number;
  passId: string;
  voucherCode: string;
  campaignName: string;
  /** Customer of the ORDER (voucher may be shared with friends). */
  customer: PromotionCustomerRef;
  /** Voucher owner — differs from `customer` when a friend used it. */
  passOwner?: { id: string | null; name: string | null };
  booking: { id: string; billCode?: string | null; displayCode: string };
  staffName: string | null;
  cancelReason?: string | null;
  /** Applied as an exception (conditions missed): who (staffName), why (overrideNote). */
  conditionsOverridden?: boolean;
  overrideReasons?: string[];
  overrideNote?: string | null;
}

export interface PromotionOrderItem {
  id: string;
  serviceName: string;
  durationMinutes: number;
  /** Line total. Negative for discount lines. */
  price: number;
  isPromotion: boolean;
}

export interface PromotionBooking {
  id: string;
  /** Real order code shown to staff (e.g. NH-021026-001). */
  billCode: string | null;
  displayCode: string;
  status: PromotionOrderStatus | string;
  customerName: string | null;
  /** Already formatted by the server as "HH:mm" (VN). */
  bookingTime: string | null;
  roomLabel: string | null;
  totalAmount: number;
  /** Paid + promotion minutes (server formula). */
  totalDurationMinutes: number;
  items: PromotionOrderItem[];
}

/** ELIGIBLE · NOT_ELIGIBLE = only conditions missed (counter may override with a reason) · BLOCKED = hard block. */
export type OrderEligibility = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'BLOCKED';

export interface PromotionOrderCandidate extends PromotionBooking {
  /** True when the order belongs to the voucher owner — sorted first. */
  isPassOwnerOrder: boolean;
  /** Order source from the engine (v13). */
  channel?: PromotionOrderChannel;
  /** Server verdict; the UI never decides eligibility. */
  canApply: boolean;
  blockedReasonCode: PromotionErrorCode | null;
  blockedReason?: string | null;
  /** Contract v8 §4.1. Missing on older servers → treated from canApply. */
  eligibility?: OrderEligibility;
  canOverride?: boolean;
  /** Ready-made Vietnamese lines from the server, shown as-is. */
  unmetReasons?: string[];
}

/** Override an unmet condition (v8 §4.1): reason is mandatory, 3–500 chars. */
export interface ApplyOverride {
  note: string;
}

export interface ApplyPromotionResult {
  usageId: string;
  appliedMinutes: number | null;
  discountAmount?: number;
  conditionsOverridden?: boolean;
  overrideReasons?: string[] | null;
  booking: PromotionBooking;
  pass: PromotionPass;
}

export interface PromotionOverviewStats {
  activeCampaigns: number;
  passesIssued: number;
  activePasses: number;
  /** EXPIRED + USED_UP + CANCELLED. */
  pastPasses?: number;
  usesThisMonth: number;
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

/**
 * Tracking tabs (engine v5 `group`): ACTIVE = usable or re-openable, soonest
 * expiry first · PAST = EXPIRED | USED_UP | CANCELLED, latest end first.
 */
export type PassGroup = 'ACTIVE' | 'PAST';

export type PassPage = Paged<PromotionPass>;

export interface PassListFilter {
  group?: PassGroup;
  search?: string;
  campaignId?: string;
  status?: PromotionPassEffectiveStatus;
  expiry?: 'VALID' | 'EXPIRING_7D' | 'EXPIRED';
  limit?: number;
  offset?: number;
}

export interface UsageListFilter {
  dateFrom?: string;
  dateTo?: string;
  campaignId?: string;
  status?: PromotionUsageStatus;
  search?: string;
  /** Only exception (override) applies. */
  overridden?: boolean;
}

export interface OrderCandidateFilter {
  search?: string;
}

/** Max customers per bulk issue = one page (50) of the candidate list (user, 03/10/2026). */
export const BULK_ISSUE_MAX = 50;

// ─── Customer profile filter (issue vouchers to the right customers) ───
// Contract v4 §3.1 (`plans/promotion_engine_api_contract.md`, Agent A).

export type CustomerGender = 'MALE' | 'FEMALE' | 'OTHER';
/** No VIP tier: use `vipMenu: 'USED'` (contract v4 §3.1). */
export type CustomerTier = 'NEW' | 'RETURNING';
export type CustomerGuestType = 'SINGLE' | 'GROUP';

export interface CustomerCandidateFilter {
  search?: string;
  /** DONE order meeting the campaign's own condition in [qualifiedFrom, qualifiedTo] (both required, ≤ 93 days). */
  onlyQualified?: boolean;
  qualifiedFrom?: string; // yyyy-MM-dd VN
  qualifiedTo?: string;
  /** Last completed visit in range (CRM "Ngày"). */
  visitFrom?: string;
  visitTo?: string;
  /** Completed visits only. */
  minVisits?: number;
  minSpent?: number;
  tier?: CustomerTier;
  /** CRM "VIP Menu": used / never used. */
  vipMenu?: 'USED' | 'NOT_USED';
  guestType?: CustomerGuestType;
  gender?: CustomerGender;
  nationality?: string;
  language?: PromotionEmailLang;
  /** Default true: e-vouchers are delivered by email. Placeholder …@guest.com counts as no email. */
  hasEmail?: boolean;
  limit?: number;
  offset?: number;
}

export interface CustomerCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gender: CustomerGender | null;
  nationality: string | null;
  language: PromotionEmailLang | null;
  /** Completed parent bookings. */
  visitCount: number;
  totalSpent: number;
  /** VN wall-clock time WITHOUT offset (e.g. "2026-10-03T09:00:00"). */
  lastVisitAt: string | null;
  vipMenuCount: number;
  vipMenuUsed?: boolean;
  guestType: CustomerGuestType;
  tier?: CustomerTier;
  /** Orders that meet the campaign condition within the qualified range. */
  qualifyingOrderCount: number;
  /** Already holds a pass of this campaign: issuing again returns ALREADY_EXISTS. */
  alreadyHasPass?: boolean;
}

export interface CustomerCandidatePage extends Paged<CustomerCandidate> {
  /** Customers matching every other criterion but without an email. */
  excludedNoEmail: number;
  /** Options for the nationality select. */
  nationalities: string[];
  /** MANUAL_ASSIGNMENT campaigns have no condition: "onlyQualified" does not apply. */
  qualificationIgnored?: boolean;
}

export interface BulkIssueItem {
  customerId: string;
  status: 'ISSUED' | 'ALREADY_EXISTS' | 'FAILED';
  passId?: string;
  voucherCode?: string;
  emailDelivery?: PromotionEmailOutcome;
  errorCode?: PromotionErrorCode;
}

export interface BulkIssueResult {
  results: BulkIssueItem[];
  summary: { issued: number; alreadyExists: number; failed: number; emailSent: number; emailFailed: number; emailSkipped: number; emailQueued?: number };
}

/** Error codes from the engine (contract v2 §9) + client-side transport codes. */
export type PromotionErrorCode =
  | 'PROMOTION_NOT_FOUND'
  | 'PROMOTION_INACTIVE'
  | 'PROMOTION_SUSPENDED'
  | 'PROMOTION_CANCELLED'
  | 'PROMOTION_NOT_STARTED'
  | 'PROMOTION_EXPIRED'
  | 'PROMOTION_USED_UP'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_ACTIVE'
  | 'ORDER_CUSTOMER_MISMATCH'
  | 'PROMOTION_ALREADY_APPLIED'
  | 'PROMOTION_USAGE_LIMIT_REACHED'
  | 'BENEFIT_NOT_SUPPORTED'
  | 'ORDER_NOT_ELIGIBLE'
  | 'ORDER_CONDITION_NOT_MET'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'PROMOTION_ITEM_IN_SERVICE'
  | 'PASS_ALREADY_EXISTS'
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_NO_EMAIL'
  | 'EMAIL_SEND_FAILED'
  | 'CAMPAIGN_LOCKED'
  | 'CAMPAIGN_ENDED'
  | 'CAMPAIGN_INVALID'
  | 'CAMPAIGN_CODE_EXISTS'
  | 'CAMPAIGN_NOT_FOUND'
  | 'USAGE_NOT_FOUND'
  | 'USAGE_COMPLETED'
  | 'INVALID_QR'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'ACCOUNT_LOCKED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export type PromotionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: PromotionErrorCode; message: string; data?: unknown } };
