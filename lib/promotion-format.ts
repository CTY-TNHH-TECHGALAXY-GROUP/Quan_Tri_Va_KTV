/**
 * Display-only formatting for promotion data. Single place for every label
 * shown on admin pages, scanner and cards. No business rule lives here.
 */
import type {
  PromotionBenefit,
  PromotionErrorCode,
  PromotionPassEffectiveStatus,
  PromotionUsageRule,
} from '@/lib/types/promotion-client';
import { ERROR_MESSAGE, USAGE_TYPE_LABEL, t } from '@/components/promotions/promotion.i18n';

const VN_TZ = 'Asia/Ho_Chi_Minh';

const dateFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: VN_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VN_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const vndFmt = new Intl.NumberFormat('vi-VN');

/** "2026-10-03T09:00:00" (no offset) is VN wall-clock time from the server, not browser-local. */
const NO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(NO_OFFSET_RE.test(iso) ? `${iso}+07:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 31/10/2026 */
export const formatPromoDate = (iso: string | null | undefined): string => {
  const d = parse(iso);
  return d ? dateFmt.format(d) : '—';
};

/** 31/10/2026 18:05 */
export const formatPromoDateTime = (iso: string | null | undefined): string => {
  const d = parse(iso);
  if (!d) return '—';
  // vi-VN puts the time first ("18:05 01/10/2026"); build "dd/MM/yyyy HH:mm" explicitly.
  const part = (type: Intl.DateTimeFormatPartTypes) => dateTimeFmt.formatToParts(d).find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
};

/** 18:05 */
export const formatPromoTime = (iso: string | null | undefined): string => {
  const d = parse(iso);
  return d ? timeFmt.format(d) : '—';
};

/** VN calendar day of an ISO timestamp → yyyy-MM-dd (for date inputs). */
export const toVnDateInput = (iso: string | null | undefined): string => {
  const d = parse(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(d);
};

// `|| 0` turns -0 into 0 (a 0đ discount line must not print "-0 VND").
export const formatVnd = (amount: number): string => `${vndFmt.format(amount || 0)} VND`;

/** "+30 phút", "-15%", "-100.000 VND" */
export const formatBenefit = (b: PromotionBenefit): string => {
  switch (b.type) {
    case 'FREE_MINUTES':
      return `+${b.value} phút`;
    case 'PERCENT_DISCOUNT':
      return `-${b.value}%`;
    case 'FIXED_DISCOUNT':
      return `-${formatVnd(b.value)}`;
    case 'FREE_SERVICE':
      return 'Tặng dịch vụ';
    case 'FREE_UPGRADE':
      return 'Nâng hạng';
  }
};

/** "Không giới hạn" | "Giới hạn 10 lần" | "Dùng 1 lần" (+ per-order cap when > 1). */
export const formatUsageType = (u: Pick<PromotionUsageRule, 'type' | 'limit' | 'maxPerOrder'>): string => {
  const base = u.type === 'LIMITED' && u.limit ? `Giới hạn ${u.limit} lần` : USAGE_TYPE_LABEL[u.type];
  return u.maxPerOrder > 1 ? `${base} · tối đa ${u.maxPerOrder}/đơn` : base;
};

/** "4 lần" or "9/10 lần" */
export const formatUsedCount = (u: Pick<PromotionUsageRule, 'type' | 'limit' | 'usedCount'>): string =>
  u.type !== 'UNLIMITED' && u.limit ? t.card.usedOfLimit(u.usedCount, u.limit) : t.card.usedTimes(u.usedCount);

/** Why a scanned voucher cannot be used, from the server's effective status. */
export const passBlockedCode = (s: PromotionPassEffectiveStatus): PromotionErrorCode =>
  (
    {
      ACTIVE: 'UNKNOWN',
      NOT_STARTED: 'PROMOTION_NOT_STARTED',
      INACTIVE: 'PROMOTION_INACTIVE',
      EXPIRED: 'PROMOTION_EXPIRED',
      USED_UP: 'PROMOTION_USED_UP',
      SUSPENDED: 'PROMOTION_SUSPENDED',
      CANCELLED: 'PROMOTION_CANCELLED',
    } as const
  )[s];

/** Server verdict for an order (v8). Older servers without `eligibility`: derived from canApply. */
export const orderEligibility = (o: { eligibility?: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'BLOCKED'; canApply: boolean; canOverride?: boolean }) =>
  o.eligibility ?? (o.canApply ? 'ELIGIBLE' : o.canOverride ? 'NOT_ELIGIBLE' : 'BLOCKED');

/** Order code shown to staff: the bill code when the server has one. */
export const orderCode = (o: { billCode?: string | null; displayCode: string }): string => o.billCode || o.displayCode;

export const promotionErrorMessage = (code: PromotionErrorCode | string | undefined): string =>
  ERROR_MESSAGE[(code as PromotionErrorCode) ?? 'UNKNOWN'] ?? ERROR_MESSAGE.UNKNOWN;
