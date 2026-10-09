// Promotion Engine enums & error codes. Business rules live in SQL (promo_* RPCs,
// migration 20261002120500_promotion_engine.sql); these mirror the DB CHECKs.

export const PROMOTION_BENEFIT_TYPES = ['FREE_MINUTES', 'PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_SERVICE', 'FREE_UPGRADE'] as const;
/** Benefit types the engine can apply today. FREE_SERVICE / FREE_UPGRADE are reserved. */
export const PROMOTION_SUPPORTED_BENEFIT_TYPES = ['FREE_MINUTES', 'PERCENT_DISCOUNT', 'FIXED_DISCOUNT'] as const;
export const PROMOTION_USAGE_TYPES = ['ONE_TIME', 'LIMITED', 'UNLIMITED'] as const;
export const PROMOTION_QUALIFICATION_TYPES = ['MIN_PAID_DURATION', 'MIN_ORDER_AMOUNT', 'SPECIFIC_SERVICE', 'MANUAL_ASSIGNMENT', 'CUSTOM'] as const;
export const PROMOTION_ASSIGNMENT_MODES = ['AUTO', 'SPECIFIC_CUSTOMER', 'CUSTOMER_GROUP', 'MANUAL_ONLY'] as const;
export const PROMOTION_CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ENDED'] as const;
export const PROMOTION_PASS_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const;
/** Computed from stored status + campaign + now(). Use this for UI, not `status`. */
export const PROMOTION_PASS_EFFECTIVE_STATUSES = ['ACTIVE', 'NOT_STARTED', 'INACTIVE', 'EXPIRED', 'USED_UP', 'SUSPENDED', 'CANCELLED'] as const;
/** Tracking tabs: ACTIVE = usable / re-openable, PAST = closed (EXPIRED, USED_UP, CANCELLED). */
export const PROMOTION_PASS_GROUPS = ['ACTIVE', 'PAST'] as const;
export const PROMOTION_USAGE_STATUSES = ['APPLIED', 'COMPLETED', 'CANCELLED'] as const;

export const PROMOTION_VALIDITY_TYPES = ['CAMPAIGN_PERIOD', 'DAYS_FROM_ISSUE'] as const;
export const PROMOTION_EMAIL_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export const PROMOTION_EXPIRY_FILTERS = ['VALID', 'EXPIRING_7D', 'EXPIRED'] as const;

/** Public e-voucher page encoded in the QR (…/voucher?t=<token>). Staff are redirected to the scanner. */
export const PROMOTION_VOUCHER_PATH = '/voucher';
/** Reception scanner page (frontend, feat/promotion-frontend). */
export const PROMOTION_SCAN_PATH = '/admin/promotions/scan';

export const PROMOTION_CUSTOMER_TIERS = ['NEW', 'RETURNING'] as const;
export const PROMOTION_GUEST_TYPES = ['SINGLE', 'GROUP'] as const;
export const PROMOTION_GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
/** Max profiles per bulk issue (= one candidate page). Also enforced in promo_issue_bulk. */
export const PROMOTION_BULK_ISSUE_MAX = 50;

export const PROMOTION_CAMPAIGN_ACTIONS = ['ACTIVATE', 'DEACTIVATE', 'END'] as const;
export const PROMOTION_PASS_ACTIONS = ['SUSPEND', 'REACTIVATE', 'CANCEL'] as const;

/** Order statuses a promotion can be applied to (OPEN / CONFIRMED / IN_SERVICE). */
export const PROMOTION_APPLICABLE_ORDER_STATUSES = ['NEW', 'PREPARING', 'IN_PROGRESS'] as const;

/** Engine-owned promotion services use ids KM0001, KM0002, ... */
export const PROMOTION_SERVICE_ID_PREFIX = 'KM';

export const PROMOTION_ERROR_HTTP_STATUS: Record<string, number> = {
    PROMOTION_NOT_FOUND: 404,
    ORDER_NOT_FOUND: 404,
    CAMPAIGN_NOT_FOUND: 404,
    CUSTOMER_NOT_FOUND: 404,
    USAGE_NOT_FOUND: 404,
    PASS_ALREADY_EXISTS: 409,
    PROMOTION_ALREADY_APPLIED: 409,
    CAMPAIGN_CODE_EXISTS: 409,
    PROMOTION_EXPIRED: 422,
    PROMOTION_NOT_STARTED: 422,
    PROMOTION_INACTIVE: 422,
    PROMOTION_SUSPENDED: 422,
    PROMOTION_USED_UP: 422,
    PROMOTION_CANCELLED: 422,
    PROMOTION_USAGE_LIMIT_REACHED: 422,
    PROMOTION_ITEM_IN_SERVICE: 422,
    ORDER_NOT_ACTIVE: 422,
    ORDER_NOT_ELIGIBLE: 422,
    ORDER_CUSTOMER_MISMATCH: 422,
    BENEFIT_NOT_SUPPORTED: 422,
    CAMPAIGN_LOCKED: 422,
    CAMPAIGN_ENDED: 422,
    USAGE_COMPLETED: 422,
    CAMPAIGN_INVALID: 400,
    QUANTITY_BELOW_ALLOCATED: 409,
    SLUG_TAKEN: 409,
    VOUCHER_NOT_RESERVED: 409,
    FEATURE_UNAVAILABLE: 501,
    WEB_CLAIM_NOT_ELIGIBLE: 409,
    WEB_CLAIM_ISSUE_FORBIDDEN: 409,
    WEB_CLAIM_PASS_MANAGED: 409,
    WEB_BOOKING_REQUIRED: 422,
    INVALID_ACTION: 400,
    VALIDATION_ERROR: 400,
    CUSTOMER_NO_EMAIL: 422,
    ORDER_MENU_NOT_ELIGIBLE: 422,
    ORDER_CONDITION_NOT_MET: 422,
    OVERRIDE_REASON_REQUIRED: 422,
    EMAIL_SEND_FAILED: 502,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    ACCOUNT_LOCKED: 423,
    INTERNAL_ERROR: 500,
};

// ─── Permissions (user 04/10/2026) ──────────────────────────────────────────
// WHO holds which permission is configured by the admin on the Roles page
// (Users.permissions). This table only says which permission each ACTION needs.

/** Full promotion access (kept from the first version). Implies every action. */
export const PROMOTION_FULL_PERMISSION = 'promotions';

export const PROMOTION_PERMISSIONS = [
    { id: 'promotions_scan_apply', name: 'KM: Quét & áp voucher', hint: 'Quét / tra mã, xem đơn đang mở, áp voucher cho đơn đủ điều kiện, huỷ lượt áp' },
    { id: 'promotions_override', name: 'KM: Áp ngoại lệ', hint: 'Áp voucher cho đơn chưa đủ điều kiện (bắt buộc ghi lý do)' },
    { id: 'promotions_view', name: 'KM: Xem voucher & lịch sử', hint: 'Tổng quan, voucher đã phát cho khách nào (SĐT / email), lịch sử dùng' },
    { id: 'promotions_issue', name: 'KM: Phát voucher', hint: 'Lọc khách, phát lẻ / hàng loạt, gửi lại email, khoá / huỷ voucher' },
    { id: 'promotions_campaign_manage', name: 'KM: Quản lý chương trình', hint: 'Tạo / sửa / kích hoạt / kết thúc chương trình, menu & điều kiện' },
] as const;

export type PromotionPermissionId = typeof PROMOTION_PERMISSIONS[number]['id'];

/** Action → any of these permissions (or PROMOTION_FULL_PERMISSION). */
export const PROMOTION_ACTION_PERMISSIONS = {
    'scan.apply': ['promotions_scan_apply'],
    'apply.override': ['promotions_override'],
    'pass.view': ['promotions_view'],
    'pass.issue': ['promotions_issue'],
    'campaign.read': ['promotions_view', 'promotions_issue', 'promotions_campaign_manage'],
    'campaign.manage': ['promotions_campaign_manage'],
    /** See the voucher owner's phone / email (scan results hide them otherwise). */
    'customer.pii': ['promotions_view', 'promotions_issue'],
} as const satisfies Record<string, readonly PromotionPermissionId[]>;

export type PromotionAction = keyof typeof PROMOTION_ACTION_PERMISSIONS;

/** Pure check (no I/O) — shared by the server guard, the UI and the QA script. */
export const promotionCan = (permissions: readonly string[] | null | undefined, action: PromotionAction): boolean => {
    const owned = new Set(permissions ?? []);
    if (owned.has(PROMOTION_FULL_PERMISSION)) return true;
    return PROMOTION_ACTION_PERMISSIONS[action].some(p => owned.has(p));
};
