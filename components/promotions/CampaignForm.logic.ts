import { useMemo, useState } from 'react';
import type { CampaignFormInput, PromotionCampaign } from '@/lib/types/promotion-client';
import { toVnDateInput } from '@/lib/promotion-format';
import { SUPPORTED_ASSIGNMENTS, SUPPORTED_BENEFIT_TYPES, t } from './promotion.i18n';

export type CampaignFormErrors = Partial<Record<keyof CampaignFormInput, string>>;

// Same rules as the engine schema (lib/schemas/promotion.schema.ts on feat/promotion-engine).
const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;
const PREFIX_RE = /^[A-Z0-9]{2,10}$/;
const MAX_VALIDITY_DAYS = 3650;

export const EMPTY_CAMPAIGN_FORM: CampaignFormInput = {
  name: '',
  campaignCode: '',
  description: '',
  benefitType: 'FREE_MINUTES',
  benefitValue: 30,
  benefitConfig: null,
  validFrom: '',
  validUntil: '',
  validityType: 'CAMPAIGN_PERIOD',
  validityDays: null,
  usageType: 'UNLIMITED',
  usageLimit: null,
  maxUsagePerOrder: 1,
  qualificationType: 'MIN_PAID_DURATION',
  qualificationValue: 90,
  // Not pre-selected (user, 02/10/2026): no menu = every menu.
  applicableMenus: null,
  // Auto issue is switched off: vouchers are issued by picking customer profiles.
  assignmentMode: 'MANUAL_ONLY',
  voucherPrefix: '',
};

export const campaignToForm = (c: PromotionCampaign): CampaignFormInput => {
  const menus = c.applicableMenus && !c.applicableMenus.allMenus ? c.applicableMenus.menus : [];
  return {
    name: c.name,
    campaignCode: c.campaignCode,
    description: c.description ?? '',
    benefitType: c.benefit.type,
    benefitValue: c.benefit.value,
    benefitConfig: c.benefit.config?.maxDiscountAmount ? { maxDiscountAmount: c.benefit.config.maxDiscountAmount } : null,
    validFrom: toVnDateInput(c.validFrom),
    validUntil: toVnDateInput(c.validUntil),
    validityType: c.validity?.type ?? 'CAMPAIGN_PERIOD',
    validityDays: c.validity?.days ?? null,
    usageType: c.usage.type,
    usageLimit: c.usage.limit,
    maxUsagePerOrder: c.usage.maxPerOrder,
    qualificationType: c.qualification.type,
    qualificationValue: c.qualification.value,
    applicableMenus: menus.length ? { menus } : null,
    assignmentMode: c.assignmentMode,
    voucherPrefix: c.voucherPrefix ?? '',
  };
};

/** Body for POST: trimmed, empty menu list = all menus. */
export const toCampaignPayload = (f: CampaignFormInput): CampaignFormInput => ({
  ...f,
  name: f.name.trim(),
  campaignCode: f.campaignCode.trim(),
  voucherPrefix: f.voucherPrefix.trim().toUpperCase(),
  benefitConfig: f.benefitType === 'PERCENT_DISCOUNT' && f.benefitConfig?.maxDiscountAmount ? f.benefitConfig : null,
  validityDays: f.validityType === 'DAYS_FROM_ISSUE' ? f.validityDays : null,
  applicableMenus: f.applicableMenus?.menus.length ? f.applicableMenus : null,
});

/** Fields an ACTIVE / INACTIVE campaign still accepts (engine: rule keys are locked). */
export const toLockedCampaignPatch = (f: CampaignFormInput): Pick<CampaignFormInput, 'name' | 'description' | 'validUntil'> => ({
  name: f.name.trim(),
  description: f.description,
  validUntil: f.validUntil,
});

/**
 * Client-side form checks for fast feedback only. Mirrors the engine schema;
 * the server re-validates and stays the authority.
 */
export const validateCampaignForm = (f: CampaignFormInput): CampaignFormErrors => {
  const e: CampaignFormErrors = {};
  const err = t.form.errors;
  if (!f.name.trim()) e.name = err.required;
  if (!f.campaignCode.trim()) e.campaignCode = err.required;
  else if (!CODE_RE.test(f.campaignCode.trim())) e.campaignCode = err.code;
  if (f.voucherPrefix.trim() && !PREFIX_RE.test(f.voucherPrefix.trim().toUpperCase())) e.voucherPrefix = err.prefix;

  if (!SUPPORTED_BENEFIT_TYPES.includes(f.benefitType)) e.benefitType = err.unsupportedBenefit;
  if (f.benefitValue == null || Number.isNaN(f.benefitValue)) e.benefitValue = err.required;
  else if (f.benefitValue <= 0) e.benefitValue = err.positive;
  else if (f.benefitType === 'FREE_MINUTES' && !Number.isInteger(f.benefitValue)) e.benefitValue = err.integer;
  else if (f.benefitType === 'PERCENT_DISCOUNT' && f.benefitValue > 100) e.benefitValue = err.percent;
  const cap = f.benefitConfig?.maxDiscountAmount;
  if (cap !== undefined && cap !== null && (Number.isNaN(cap) || cap <= 0)) e.benefitConfig = err.positive;

  if (!f.validFrom) e.validFrom = err.required;
  if (!f.validUntil) e.validUntil = err.required;
  if (f.validFrom && f.validUntil && f.validUntil < f.validFrom) e.validUntil = err.dateOrder;
  if (
    f.validityType === 'DAYS_FROM_ISSUE' &&
    (!f.validityDays || !Number.isInteger(f.validityDays) || f.validityDays < 1 || f.validityDays > MAX_VALIDITY_DAYS)
  ) {
    e.validityDays = err.validityDays;
  }

  if (f.usageType === 'LIMITED' && (!f.usageLimit || f.usageLimit < 1 || !Number.isInteger(f.usageLimit))) {
    e.usageLimit = err.usageLimit;
  }
  if (!f.maxUsagePerOrder || f.maxUsagePerOrder < 1) e.maxUsagePerOrder = err.perOrder;

  if (f.qualificationType === 'MIN_PAID_DURATION' && (!f.qualificationValue || f.qualificationValue <= 0)) {
    e.qualificationValue = err.positive;
  }
  if (!SUPPORTED_ASSIGNMENTS.includes(f.assignmentMode)) e.assignmentMode = err.autoNeedsRule;
  return e;
};

export const useCampaignForm = (initial: CampaignFormInput) => {
  const [form, setForm] = useState<CampaignFormInput>(initial);
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateCampaignForm(form), [form]);

  const set = <K extends keyof CampaignFormInput>(key: K, value: CampaignFormInput[K]) =>
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'usageType' && value !== 'LIMITED') next.usageLimit = null;
      if (key === 'qualificationType' && value !== 'MIN_PAID_DURATION') next.qualificationValue = null;
      if (key === 'benefitType' && value !== 'PERCENT_DISCOUNT') next.benefitConfig = null;
      if (key === 'validityType' && value !== 'DAYS_FROM_ISSUE') next.validityDays = null;
      return next;
    });

  const toggleMenu = (code: string) =>
    setForm((prev) => {
      const menus = prev.applicableMenus?.menus ?? [];
      const next = menus.includes(code) ? menus.filter((m) => m !== code) : [...menus, code];
      return { ...prev, applicableMenus: next.length ? { menus: next } : null };
    });

  return {
    form,
    set,
    toggleMenu,
    errors: touched ? errors : {},
    isValid: Object.keys(errors).length === 0,
    touch: () => setTouched(true),
  };
};
