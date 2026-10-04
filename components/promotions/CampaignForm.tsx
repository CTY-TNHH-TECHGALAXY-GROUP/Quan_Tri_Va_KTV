'use client';

import React, { useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import type {
  CampaignFormInput,
  PromotionAssignmentMode,
  PromotionBenefitType,
  PromotionEmailLang,
  PromotionTextI18n,
  PromotionUsageType,
  PromotionValidityType,
} from '@/lib/types/promotion-client';
import { promotionApi } from '@/lib/services/promotionApi';
import { useCampaignForm, type CampaignFormErrors } from './CampaignForm.logic';
import ApplyConditionsEditor from './ApplyConditionsEditor';
import { DateControl, SelectControl } from './FormControls';
import { usePromotionQuery } from './usePromotionQuery';
import VoucherCard3D from './VoucherCard3D';
import VoucherLangTabs from './VoucherLangTabs';
import { VOUCHER_CARD_LABELS, VOUCHER_LANG_NAMES } from './voucher-card.i18n';
import { useSpaContact } from './useSpaContact';
import { voucherCardFromForm } from './VoucherCard3D.logic';
import {
  ASSIGNMENT_LABEL,
  BENEFIT_TYPE_LABEL,
  DISABLED_ASSIGNMENT_NOTE,
  SUPPORTED_ASSIGNMENTS,
  SUPPORTED_BENEFIT_TYPES,
  USAGE_TYPE_LABEL,
  t,
} from './promotion.i18n';

// 🔧 UI CONFIGURATION
const BENEFIT_TYPES = Object.keys(BENEFIT_TYPE_LABEL) as PromotionBenefitType[];
const USAGE_TYPES: PromotionUsageType[] = ['UNLIMITED', 'LIMITED', 'ONE_TIME'];
const VALIDITY_TYPES: { value: PromotionValidityType; label: string }[] = [
  { value: 'CAMPAIGN_PERIOD', label: t.form.validityCampaign },
  { value: 'DAYS_FROM_ISSUE', label: t.form.validityDays },
];
const ASSIGNMENT_MODES = Object.keys(ASSIGNMENT_LABEL) as PromotionAssignmentMode[];
/** Fields an active campaign may still change (engine locks rule keys). */
const LOCKED_EDITABLE: (keyof CampaignFormInput)[] = ['name', 'description', 'nameI18n', 'descriptionI18n', 'validUntil'];
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

const inputClass = (hasError?: boolean, disabled?: boolean) =>
  `min-h-11 w-full rounded-xl border bg-white px-3 text-sm focus:outline-none focus:ring-2 ${
    hasError ? 'border-rose-300 focus:ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-indigo-100'
  } ${disabled ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`;

const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
    {children}
    {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
  </label>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  </section>
);

const toNumber = (v: string): number | null => (v === '' ? null : Number(v));

interface CampaignFormProps {
  initial: CampaignFormInput;
  /** Campaign was activated: only name / description / end date stay editable (engine rule). */
  lockRules?: boolean;
  /** Code + prefix are frozen after creation. */
  lockIdentity?: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (input: CampaignFormInput) => void;
}

const CampaignForm = ({ initial, lockRules = false, lockIdentity = false, submitting, submitLabel, onSubmit }: CampaignFormProps) => {
  const { form, set, setConditions, errors, isValid, touch } = useCampaignForm(initial);
  const menus = usePromotionQuery(() => promotionApi.getMenus(), []);
  const spaContact = useSpaContact();
  // Language being edited for name / description; the preview card follows it.
  const [lang, setLang] = useState<PromotionEmailLang>('en');
  const isEn = lang === 'en';
  const tr = (v: PromotionTextI18n) => (isEn ? '' : (v[lang as keyof PromotionTextI18n] ?? ''));
  const setTr = (key: 'nameI18n' | 'descriptionI18n', value: string) => set(key, { ...form[key], [lang]: value });
  const filled = Object.fromEntries(
    (['vi', 'cn', 'jp', 'kr'] as const).map((l) => [l, !!(form.nameI18n[l]?.trim() || form.descriptionI18n[l]?.trim())]),
  ) as Partial<Record<PromotionEmailLang, boolean>>;

  // When rules are locked only the editable fields can block saving.
  const shownErrors: CampaignFormErrors = lockRules
    ? Object.fromEntries(Object.entries(errors).filter(([k]) => LOCKED_EDITABLE.includes(k as keyof CampaignFormInput)))
    : errors;
  const canSave = lockRules ? Object.keys(shownErrors).length === 0 && !!form.name.trim() && !!form.validUntil : isValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    touch();
    if (!canSave || submitting) return;
    onSubmit(form);
  };

  const benefitValueLabel =
    form.benefitType === 'PERCENT_DISCOUNT'
      ? t.form.benefitValuePercent
      : form.benefitType === 'FIXED_DISCOUNT'
        ? t.form.benefitValueAmount
        : t.form.benefitValueMinutes;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
      {/* Template preview first on mobile, sticky beside the form on desktop */}
      <aside className="rounded-3xl border border-gray-100 bg-gradient-to-b from-white to-indigo-50/50 p-5 shadow-sm xl:sticky xl:top-4 xl:order-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.voucher.previewTitle}</p>
        <p className="mb-4 mt-1 text-xs text-gray-500">{t.voucher.previewHint}</p>
        <div className="flex justify-center">
          <VoucherCard3D data={voucherCardFromForm(form, menus.state.data, lang)} labels={VOUCHER_CARD_LABELS[lang]} contact={spaContact} />
        </div>
      </aside>

      <form onSubmit={handleSubmit} noValidate className="space-y-5 xl:order-1">
        {lockRules && (
          <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
            <Lock size={16} className="mt-0.5 shrink-0" aria-hidden />
            {t.campaign.lockedRules}
          </p>
        )}

        <Section title={t.form.sectionInfo}>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">{t.form.contentLang}</span>
            <VoucherLangTabs value={lang} onChange={setLang} label={t.form.contentLang} filled={filled} requiredEn />
            <span className="mt-1.5 block text-xs text-gray-500">{t.form.contentLangHint}</span>
          </div>
          <div className="sm:col-span-2">
            {isEn ? (
              <Field label={t.form.nameEnglish} error={shownErrors.name}>
                <input className={inputClass(!!shownErrors.name)} value={form.name} maxLength={NAME_MAX} placeholder={t.form.namePlaceholder} onChange={(e) => set('name', e.target.value)} />
              </Field>
            ) : (
              <Field label={`${t.form.name} · ${t.form.translationOf(VOUCHER_LANG_NAMES[lang])}`}>
                <input
                  lang={lang}
                  className={inputClass()}
                  value={tr(form.nameI18n)}
                  maxLength={NAME_MAX}
                  placeholder={t.form.translationPlaceholder(form.name.trim())}
                  onChange={(e) => setTr('nameI18n', e.target.value)}
                />
              </Field>
            )}
          </div>
          <Field label={t.form.campaignCode} hint={t.form.campaignCodeHint} error={shownErrors.campaignCode}>
            <input
              className={`${inputClass(!!shownErrors.campaignCode, lockIdentity)} font-mono`}
              value={form.campaignCode}
              disabled={lockIdentity}
              maxLength={40}
              onChange={(e) => set('campaignCode', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t.form.voucherPrefix} hint={t.form.voucherPrefixHint} error={shownErrors.voucherPrefix}>
            <input
              className={`${inputClass(!!shownErrors.voucherPrefix, lockIdentity)} font-mono uppercase`}
              value={form.voucherPrefix}
              disabled={lockIdentity}
              maxLength={10}
              onChange={(e) => set('voucherPrefix', e.target.value.toUpperCase())}
            />
          </Field>
          <div className="sm:col-span-2">
            {isEn ? (
              <Field label={`${t.form.description} · ${VOUCHER_LANG_NAMES.en}`}>
                <textarea className={`${inputClass()} min-h-20 py-2`} value={form.description} maxLength={DESCRIPTION_MAX} onChange={(e) => set('description', e.target.value)} />
              </Field>
            ) : (
              <Field label={`${t.form.description} · ${t.form.translationOf(VOUCHER_LANG_NAMES[lang])}`}>
                <textarea
                  lang={lang}
                  className={`${inputClass()} min-h-20 py-2`}
                  value={tr(form.descriptionI18n)}
                  maxLength={DESCRIPTION_MAX}
                  placeholder={t.form.translationPlaceholder('')}
                  onChange={(e) => setTr('descriptionI18n', e.target.value)}
                />
              </Field>
            )}
          </div>
        </Section>

        <Section title={t.form.sectionBenefit}>
          <Field label={t.form.benefitType} error={shownErrors.benefitType}>
            <SelectControl
              invalid={!!shownErrors.benefitType}
              value={form.benefitType}
              disabled={lockRules}
              onChange={(e) => set('benefitType', e.target.value as PromotionBenefitType)}
            >
              {BENEFIT_TYPES.map((b) => (
                <option key={b} value={b} disabled={!SUPPORTED_BENEFIT_TYPES.includes(b)}>
                  {BENEFIT_TYPE_LABEL[b]}
                  {!SUPPORTED_BENEFIT_TYPES.includes(b) ? ` (${t.form.benefitComingSoon})` : ''}
                </option>
              ))}
            </SelectControl>
          </Field>
          <Field label={benefitValueLabel} error={shownErrors.benefitValue}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={form.benefitType === 'PERCENT_DISCOUNT' ? 100 : undefined}
              step={form.benefitType === 'FIXED_DISCOUNT' ? 1000 : 1}
              className={inputClass(!!shownErrors.benefitValue, lockRules)}
              disabled={lockRules}
              value={form.benefitValue ?? ''}
              onChange={(e) => set('benefitValue', toNumber(e.target.value))}
            />
          </Field>
          {form.benefitType === 'PERCENT_DISCOUNT' && (
            <Field label={t.form.maxDiscountAmount} hint={t.form.maxDiscountAmountHint} error={shownErrors.benefitConfig}>
              <input
                type="number"
                inputMode="numeric"
                min={1000}
                step={1000}
                className={inputClass(!!shownErrors.benefitConfig, lockRules)}
                disabled={lockRules}
                value={form.benefitConfig?.maxDiscountAmount ?? ''}
                onChange={(e) => {
                  const v = toNumber(e.target.value);
                  set('benefitConfig', v === null ? null : { maxDiscountAmount: v });
                }}
              />
            </Field>
          )}
        </Section>

        <Section title={t.form.sectionValidity}>
          <Field label={t.form.validFrom} error={shownErrors.validFrom}>
            <DateControl invalid={!!shownErrors.validFrom} disabled={lockRules} value={form.validFrom} onChange={(v) => set('validFrom', v)} />
          </Field>
          <Field label={t.form.validUntil} error={shownErrors.validUntil}>
            <DateControl invalid={!!shownErrors.validUntil} value={form.validUntil} min={form.validFrom || undefined} onChange={(v) => set('validUntil', v)} />
          </Field>
          <Field label={t.form.validityType}>
            <SelectControl invalid={false} disabled={lockRules} value={form.validityType} onChange={(e) => set('validityType', e.target.value as PromotionValidityType)}>
              {VALIDITY_TYPES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </SelectControl>
          </Field>
          {form.validityType === 'DAYS_FROM_ISSUE' && (
            <Field label={t.form.validityDaysLabel} hint={t.form.validityDaysHint} error={shownErrors.validityDays}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                className={inputClass(!!shownErrors.validityDays, lockRules)}
                disabled={lockRules}
                value={form.validityDays ?? ''}
                onChange={(e) => set('validityDays', toNumber(e.target.value))}
              />
            </Field>
          )}
        </Section>

        <Section title={t.form.sectionUsage}>
          <Field label={t.form.usageType}>
            <SelectControl invalid={false} disabled={lockRules} value={form.usageType} onChange={(e) => set('usageType', e.target.value as PromotionUsageType)}>
              {USAGE_TYPES.map((u) => (
                <option key={u} value={u}>
                  {USAGE_TYPE_LABEL[u]}
                </option>
              ))}
            </SelectControl>
          </Field>
          {form.usageType === 'LIMITED' && (
            <Field label={t.form.usageLimit} hint={t.form.usageLimitHint} error={shownErrors.usageLimit}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                className={inputClass(!!shownErrors.usageLimit, lockRules)}
                disabled={lockRules}
                value={form.usageLimit ?? ''}
                onChange={(e) => set('usageLimit', toNumber(e.target.value))}
              />
            </Field>
          )}
          <Field label={t.form.maxUsagePerOrder} error={shownErrors.maxUsagePerOrder}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              className={inputClass(!!shownErrors.maxUsagePerOrder, lockRules)}
              disabled={lockRules}
              value={form.maxUsagePerOrder}
              onChange={(e) => set('maxUsagePerOrder', Number(e.target.value))}
            />
          </Field>
        </Section>

        <Section title={t.form.sectionEligibility}>
          <ApplyConditionsEditor
            value={form.applyConditions}
            onChange={setConditions}
            menus={menus.state.data ?? []}
            disabled={lockRules}
            error={shownErrors.applyConditions}
          />
          <Field label={t.form.assignmentMode} error={shownErrors.assignmentMode}>
            <SelectControl invalid={!!shownErrors.assignmentMode} disabled={lockRules} value={form.assignmentMode} onChange={(e) => set('assignmentMode', e.target.value as PromotionAssignmentMode)}>
              {ASSIGNMENT_MODES.map((a) => (
                <option key={a} value={a} disabled={!SUPPORTED_ASSIGNMENTS.includes(a)}>
                  {ASSIGNMENT_LABEL[a]}
                  {!SUPPORTED_ASSIGNMENTS.includes(a) ? ` (${DISABLED_ASSIGNMENT_NOTE[a] ?? t.form.benefitComingSoon})` : ''}
                </option>
              ))}
            </SelectControl>
          </Field>
        </Section>

        <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-gray-100 bg-white/90 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CampaignForm;
