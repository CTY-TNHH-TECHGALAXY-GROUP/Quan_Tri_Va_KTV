import { useMemo, useState } from 'react';
import type { CampaignFormInput, PromotionApplyCondition, PromotionCampaign, PromotionTextI18n } from '@/lib/types/promotion-client';
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
  nameI18n: {},
  descriptionI18n: {},
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
  // No condition pre-filled (user, 02/10/2026): empty = any order.
  applyConditions: { match: 'ALL', conditions: [] },
  // Auto issue is switched off: vouchers are issued by picking customer profiles.
  assignmentMode: 'MANUAL_ONLY',
  voucherPrefix: '',
};

export const campaignToForm = (c: PromotionCampaign): CampaignFormInput => {
  return {
    name: c.name,
    campaignCode: c.campaignCode,
    description: c.description ?? '',
    nameI18n: c.nameI18n ?? {},
    descriptionI18n: c.descriptionI18n ?? {},
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
    applyConditions: c.applyConditions ?? { match: 'ALL', conditions: [] },
    assignmentMode: c.assignmentMode,
    voucherPrefix: c.voucherPrefix ?? '',
  };
};

/** Drop empty translations; a missing language shows the English text. */
const trimI18n = (v: PromotionTextI18n): PromotionTextI18n =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (x ?? '').trim()]).filter(([, x]) => x)) as PromotionTextI18n;

/** Body for POST: trimmed; conditions sent as-is (empty list = any order). */
export const toCampaignPayload = (f: CampaignFormInput): CampaignFormInput => ({
  ...f,
  name: f.name.trim(),
  nameI18n: trimI18n(f.nameI18n),
  descriptionI18n: trimI18n(f.descriptionI18n),
  campaignCode: f.campaignCode.trim(),
  voucherPrefix: f.voucherPrefix.trim().toUpperCase(),
  benefitConfig: f.benefitType === 'PERCENT_DISCOUNT' && f.benefitConfig?.maxDiscountAmount ? f.benefitConfig : null,
  validityDays: f.validityType === 'DAYS_FROM_ISSUE' ? f.validityDays : null,
  applyConditions: {
    match: f.applyConditions.match,
    conditions: f.applyConditions.conditions.map((c) => ({
      menus: c.menus,
      categories: c.categories,
      serviceIds: c.serviceIds,
      minMinutes: c.minMinutes || null,
      minOrderAmount: c.minOrderAmount ?? null,
    })),
  },
});

/** Fields an ACTIVE / INACTIVE campaign still accepts (engine: rule keys are locked). */
export const toLockedCampaignPatch = (
  f: CampaignFormInput,
): Pick<CampaignFormInput, 'name' | 'description' | 'nameI18n' | 'descriptionI18n' | 'validUntil'> => ({
  name: f.name.trim(),
  description: f.description,
  // Display text only: translations stay editable after vouchers were issued.
  nameI18n: trimI18n(f.nameI18n),
  descriptionI18n: trimI18n(f.descriptionI18n),
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

  const condError = applyConditionsError(f.applyConditions);
  if (condError) e.applyConditions = condError;
  if (!SUPPORTED_ASSIGNMENTS.includes(f.assignmentMode)) e.assignmentMode = err.autoNeedsRule;
  return e;
};

export const MAX_APPLY_CONDITIONS = 10;

export const EMPTY_APPLY_CONDITION: PromotionApplyCondition = { menus: [], categories: [], serviceIds: [], minMinutes: null, minOrderAmount: null };

/** Same rules as the engine schema: ≥ 1 criterion per condition, ≤ 10 conditions, positive numbers. */
export const applyConditionsError = (ac: CampaignFormInput['applyConditions']): string | undefined => {
  const err = t.form.errors;
  if (ac.conditions.length > MAX_APPLY_CONDITIONS) return err.tooManyConditions(MAX_APPLY_CONDITIONS);
  for (let i = 0; i < ac.conditions.length; i++) {
    const c = ac.conditions[i];
    const hasCriterion = c.menus.length || c.categories.length || c.serviceIds.length || c.minMinutes || c.minOrderAmount != null;
    if (!hasCriterion) return err.emptyCondition(i + 1);
    if (c.minMinutes != null && (!Number.isInteger(c.minMinutes) || c.minMinutes <= 0)) return err.conditionMinutes(i + 1);
    if (c.minOrderAmount != null && (Number.isNaN(c.minOrderAmount) || c.minOrderAmount < 0)) return err.conditionAmount(i + 1);
  }
  return undefined;
};

export const useCampaignForm = (initial: CampaignFormInput) => {
  const [form, setForm] = useState<CampaignFormInput>(initial);
  const [touched, setTouched] = useState(false);
  const errors = useMemo(() => validateCampaignForm(form), [form]);

  const set = <K extends keyof CampaignFormInput>(key: K, value: CampaignFormInput[K]) =>
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'usageType' && value !== 'LIMITED') next.usageLimit = null;
      if (key === 'benefitType' && value !== 'PERCENT_DISCOUNT') next.benefitConfig = null;
      if (key === 'validityType' && value !== 'DAYS_FROM_ISSUE') next.validityDays = null;
      return next;
    });

  /** Conditions editor (v7 §2.2): replace the whole object so React sees the change. */
  const setConditions = (fn: (ac: CampaignFormInput['applyConditions']) => CampaignFormInput['applyConditions']) =>
    setForm((prev) => ({ ...prev, applyConditions: fn(prev.applyConditions) }));

  return {
    form,
    set,
    setConditions,
    errors: touched ? errors : {},
    isValid: Object.keys(errors).length === 0,
    touch: () => setTouched(true),
  };
};
