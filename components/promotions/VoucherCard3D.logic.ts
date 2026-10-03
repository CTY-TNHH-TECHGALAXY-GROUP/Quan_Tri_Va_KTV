import type {
  CampaignFormInput,
  PromotionBenefit,
  PromotionCampaign,
  PromotionConditions,
  PromotionPass,
  PromotionPassEffectiveStatus,
  PromotionPassWithQr,
  PromotionUsageRule,
} from '@/lib/types/promotion-client';

/**
 * What the voucher card renders. Built either from a real pass (staff checks
 * it against the customer's e-voucher) or from a campaign (template preview,
 * no voucher code exists yet).
 */
export interface VoucherCardData {
  campaignName: string;
  benefit: PromotionBenefit;
  usage: Pick<PromotionUsageRule, 'type' | 'limit' | 'maxPerOrder'> & { usedCount: number | null };
  validUntil: string | null;
  /** Real code, or null on templates (a placeholder mask is shown instead). */
  voucherCode: string | null;
  voucherPrefix: string;
  customerName: string | null;
  status: PromotionPassEffectiveStatus | null;
  /** Server QR value; null on list rows and templates. */
  qrPayload: string | null;
  isTemplate: boolean;
  /** "Dành cho Menu VIP từ 90 phút trở lên"; omitted → generic "complimentary" line. */
  conditions?: PromotionConditions;
}

/** Menu codes → display names (codes kept when no label is known). */
export type MenuLabelOf = (code: string) => string;

const minMinutesOf = (type: PromotionCampaign['qualification']['type'], value: number | null): number | null =>
  type === 'MIN_PAID_DURATION' && value ? value : null;

const prefixOf = (code: string) => code.split('-')[0] ?? code;

export const voucherCardFromPass = (pass: PromotionPass | PromotionPassWithQr): VoucherCardData => ({
  campaignName: pass.campaign.name,
  benefit: pass.benefit,
  usage: pass.usage,
  validUntil: pass.validUntil,
  voucherCode: pass.voucherCode,
  voucherPrefix: prefixOf(pass.voucherCode),
  customerName: pass.customer.name,
  status: pass.effectiveStatus,
  qrPayload: 'qrPayload' in pass ? pass.qrPayload : null,
  isTemplate: false,
  conditions: pass.conditions,
});

export const voucherCardFromCampaign = (c: PromotionCampaign, menuLabel: MenuLabelOf = (x) => x): VoucherCardData => ({
  campaignName: c.name,
  benefit: c.benefit,
  usage: { ...c.usage, usedCount: null },
  validUntil: c.validUntil,
  voucherCode: null,
  voucherPrefix: c.voucherPrefix,
  customerName: null,
  status: null,
  qrPayload: null,
  isTemplate: true,
  conditions: {
    menuLabels: c.applicableMenus && !c.applicableMenus.allMenus ? c.applicableMenus.menus.map(menuLabel) : [],
    minPaidMinutes: minMinutesOf(c.qualification.type, c.qualification.value),
  },
});

/** Live preview while the admin is filling the campaign form. */
export const voucherCardFromForm = (f: CampaignFormInput, menuLabel: MenuLabelOf = (x) => x): VoucherCardData => ({
  campaignName: f.name.trim(),
  benefit: { type: f.benefitType, value: f.benefitValue ?? 0 },
  usage: {
    type: f.usageType,
    limit: f.usageType === 'LIMITED' ? f.usageLimit : f.usageType === 'ONE_TIME' ? 1 : null,
    maxPerOrder: f.maxUsagePerOrder || 1,
    usedCount: null,
  },
  validUntil: f.validUntil ? `${f.validUntil}T23:59:59+07:00` : null,
  voucherCode: null,
  voucherPrefix: f.voucherPrefix.trim(),
  customerName: null,
  status: null,
  qrPayload: null,
  isTemplate: true,
  conditions: {
    menuLabels: (f.applicableMenus?.menus ?? []).map(menuLabel),
    minPaidMinutes: minMinutesOf(f.qualificationType, f.qualificationValue),
  },
});

/** Public e-voucher (/voucher?t=) — mirrors Agent A `PromotionPublicVoucherDto`. No phone / email / orders. */
export interface PublicVoucher {
  campaignName: string;
  benefit: PromotionBenefit;
  usage: { type: PromotionUsageRule['type']; limit: number | null; maxPerOrder: number; usedCount: number };
  validFrom: string;
  validUntil: string;
  voucherCode: string;
  voucherPrefix: string;
  customerName: string | null;
  effectiveStatus: PromotionPassEffectiveStatus;
  applicableMenus: { menus: string[]; categories: string[]; serviceIds: string[]; allMenus: boolean };
  /** Display names of `applicableMenus.menus` when the server provides them. */
  menuLabels?: string[];
  /** Minimum paid minutes printed as a condition (requested from Agent A). */
  minPaidMinutes?: number | null;
  /** Present while the voucher is usable (ACTIVE / NOT_STARTED). */
  qrPayload: string | null;
}

export const voucherCardFromPublic = (v: PublicVoucher): VoucherCardData => ({
  campaignName: v.campaignName,
  benefit: v.benefit,
  usage: v.usage,
  validUntil: v.validUntil,
  voucherCode: v.voucherCode,
  voucherPrefix: v.voucherPrefix,
  customerName: v.customerName,
  status: v.effectiveStatus,
  qrPayload: v.qrPayload,
  isTemplate: false,
  conditions: {
    menuLabels: v.applicableMenus.allMenus ? [] : (v.menuLabels?.length ? v.menuLabels : v.applicableMenus.categories.length ? v.applicableMenus.categories : v.applicableMenus.menus),
    minPaidMinutes: v.minPaidMinutes ?? null,
  },
});
