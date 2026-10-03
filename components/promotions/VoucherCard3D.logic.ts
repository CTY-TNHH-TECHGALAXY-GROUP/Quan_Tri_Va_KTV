import type {
  CampaignFormInput,
  PromotionBenefit,
  PromotionCampaign,
  PromotionConditionsSummary,
  PromotionMenu,
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
  /** Engine conditions with labels; formatted by formatPromotionConditions. Empty → "complimentary" line. */
  conditionsSummary?: PromotionConditionsSummary;
}

/**
 * Form preview only: label the conditions being typed (codes → names from the
 * /menus catalogue). Saved campaigns / passes use the server's conditionsSummary.
 */
export const summarizeConditions = (
  ac: CampaignFormInput['applyConditions'],
  menus: PromotionMenu[] | null | undefined,
): PromotionConditionsSummary => {
  const list = menus ?? [];
  const menuLabel = (code: string) => list.find((m) => m.code === code)?.label ?? code;
  const catLabel = (code: string) => list.flatMap((m) => m.categories).find((c) => c.code === code)?.label ?? code;
  const svcName = (id: string) => list.flatMap((m) => m.services).find((s) => s.id === id)?.name ?? id;
  return {
    match: ac.match,
    conditions: ac.conditions.map((c) => ({
      menus: c.menus.map(menuLabel),
      categories: c.categories.map(catLabel),
      services: c.serviceIds.map(svcName),
      minMinutes: c.minMinutes,
      minOrderAmount: c.minOrderAmount,
    })),
  };
};

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
  conditionsSummary: pass.conditionsSummary,
});

export const voucherCardFromCampaign = (c: PromotionCampaign): VoucherCardData => ({
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
  conditionsSummary: c.conditionsSummary,
});

/** Live preview while the admin is filling the campaign form. */
export const voucherCardFromForm = (f: CampaignFormInput, menus?: PromotionMenu[] | null): VoucherCardData => ({
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
  conditionsSummary: summarizeConditions(f.applyConditions, menus),
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
  /** Display names of the scope for the customer page; [] = all menus. */
  menuLabels?: string[];
  /** Conditions with labels; formatted by formatPromotionConditions. */
  conditionsSummary?: PromotionConditionsSummary;
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
  conditionsSummary: v.conditionsSummary,
});
