'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Filter, Loader2, MailWarning, RotateCcw, Search, X } from 'lucide-react';
import type { CustomerCandidate, CustomerCandidateFilter, PromotionCampaign } from '@/lib/types/promotion-client';
import { BULK_ISSUE_MAX } from '@/lib/services/promotionApi';
import { formatBenefit, formatPromoDate, formatVnd, promotionErrorMessage } from '@/lib/promotion-format';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CANDIDATE_PAGE_SIZE, useCustomerCandidates } from './CustomerCandidates.logic';
import { PromotionEmpty, PromotionError, PromotionLoading } from './PromotionStates';
import { CUSTOMER_TIER_LABEL, GENDER_LABEL, GUEST_TYPE_LABEL, LANGUAGE_LABEL, t } from './promotion.i18n';

const control =
  'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const L = ({ label, hint, children, className = '' }: { label: string; hint?: string; children: React.ReactNode; className?: string }) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] text-gray-500">{hint}</span>}
  </label>
);

const Select = <V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | undefined;
  options: Record<V, string> | readonly V[];
  onChange: (v: V | undefined) => void;
}) => {
  const entries: [string, string][] = Array.isArray(options) ? options.map((o) => [o, o]) : Object.entries(options);
  return (
    <L label={label}>
      <select className={control} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as V | undefined)}>
        <option value="">{t.assign.any}</option>
        {entries.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </L>
  );
};

const Checkbox = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    onClick={onChange}
    className="inline-flex min-h-11 items-center gap-2 text-left text-sm font-medium text-gray-800"
  >
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white'}`} aria-hidden>
      {checked && <Check size={14} />}
    </span>
    {label}
  </button>
);

const RowCheck = ({ on, onClick, label, disabled = false }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    // The whole row also toggles; stop here so one tap = one toggle.
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed"
  >
    <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white'}`} aria-hidden>
      {on && <Check size={14} />}
    </span>
  </button>
);

const ADVANCED_KEYS = ['visitFrom', 'visitTo', 'minVisits', 'minSpent', 'tier', 'vipMenu', 'guestType', 'gender', 'nationality', 'language'] as const;

const qualificationLabel = (c: PromotionCampaign): string =>
  c.qualification.type === 'MIN_PAID_DURATION' && c.qualification.value ? `${t.assign.onlyQualified} (≥ ${c.qualification.value} phút)` : t.assign.onlyQualified;

/** Campaign detail → filter customer profiles → select (max one page) → issue + email. */
const CustomerCandidatesPanel = ({ campaign }: { campaign: PromotionCampaign }) => {
  const s = useCustomerCandidates(campaign.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Phones: advanced criteria collapsed so the result list stays reachable.
  const [showMore, setShowMore] = useState(false);
  const f = s.draft;
  const set = s.setField;
  const page = s.state.status === 'success' ? s.state.page : null;

  const num = (v: string) => (v === '' ? undefined : Number(v));
  // MANUAL_ASSIGNMENT campaigns have no order condition → the "qualified" filter does not apply.
  const noCondition = campaign.qualification.type === 'MANUAL_ASSIGNMENT' || !!page?.qualificationIgnored;
  const advancedCount = ADVANCED_KEYS.filter((k) => f[k] !== undefined && f[k] !== '').length;
  const field = <K extends keyof CustomerCandidateFilter>(k: K) => (v: CustomerCandidateFilter[K]) => set(k, v);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <form
        className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          s.apply();
        }}
      >
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Filter size={16} aria-hidden />
          {t.assign.filterTitle}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <L label={t.assign.searchLabel} className="sm:col-span-2">
            <span className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
              <input type="search" className={`${control} pl-9`} value={f.search ?? ''} onChange={(e) => set('search', e.target.value)} />
            </span>
          </L>
          <div className="flex flex-wrap items-end gap-x-5 sm:col-span-2">
            {noCondition ? (
              <p className="min-h-11 content-center text-xs text-gray-500">{t.assign.qualificationIgnored}</p>
            ) : (
              <Checkbox checked={!!f.onlyQualified} onChange={() => set('onlyQualified', !f.onlyQualified)} label={qualificationLabel(campaign)} />
            )}
            <Checkbox checked={f.hasEmail !== false} onChange={() => set('hasEmail', f.hasEmail === false)} label={t.assign.hasEmail} />
          </div>

          {f.onlyQualified && !noCondition && (
            <>
              <L label={`${t.assign.qualifiedRange} — ${t.assign.from}`}>
                <input type="date" className={control} value={f.qualifiedFrom ?? ''} onChange={(e) => set('qualifiedFrom', e.target.value)} />
              </L>
              <L label={`${t.assign.qualifiedRange} — ${t.assign.to}`}>
                <input type="date" className={control} value={f.qualifiedTo ?? ''} onChange={(e) => set('qualifiedTo', e.target.value)} />
              </L>
              {s.rangeError && (
                <p role="alert" className="text-xs font-medium text-rose-600 sm:col-span-2">
                  {t.assign.qualifiedRangeRequired}
                </p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="inline-flex min-h-11 items-center gap-2 justify-self-start text-sm font-semibold text-indigo-700 sm:col-span-2 xl:hidden"
          >
            <ChevronDown size={16} className={showMore ? 'rotate-180' : ''} aria-hidden />
            {showMore ? t.assign.lessFilters : t.assign.moreFilters(advancedCount)}
          </button>
          <div className={showMore ? 'contents' : 'hidden xl:contents'}>
          <L label={`${t.assign.visitRange} — ${t.assign.from}`}>
            <input type="date" className={control} value={f.visitFrom ?? ''} onChange={(e) => set('visitFrom', e.target.value)} />
          </L>
          <L label={`${t.assign.visitRange} — ${t.assign.to}`}>
            <input type="date" className={control} value={f.visitTo ?? ''} onChange={(e) => set('visitTo', e.target.value)} />
          </L>
          <L label={t.assign.minVisits} hint={t.assign.minVisitsHint}>
            <input type="number" inputMode="numeric" min={1} className={control} value={f.minVisits ?? ''} onChange={(e) => set('minVisits', num(e.target.value))} />
          </L>
          <L label={t.assign.minSpent}>
            <input type="number" inputMode="numeric" min={0} step={100000} className={control} value={f.minSpent ?? ''} onChange={(e) => set('minSpent', num(e.target.value))} />
          </L>
          <Select label={t.assign.tier} value={f.tier} options={CUSTOMER_TIER_LABEL} onChange={field('tier')} />
          <Select label={t.assign.vipMenu} value={f.vipMenu} options={{ USED: t.assign.vipMenuUsed, NOT_USED: t.assign.vipMenuNotUsed }} onChange={field('vipMenu')} />
          <Select label={t.assign.guestType} value={f.guestType} options={GUEST_TYPE_LABEL} onChange={field('guestType')} />
          <Select label={t.assign.gender} value={f.gender} options={GENDER_LABEL} onChange={field('gender')} />
          <Select label={t.assign.nationality} value={f.nationality} options={page?.nationalities ?? []} onChange={field('nationality')} />
          <Select label={t.assign.language} value={f.language} options={LANGUAGE_LABEL} onChange={field('language')} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={s.reset} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700">
            <RotateCcw size={16} aria-hidden />
            {t.assign.reset}
          </button>
          <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white">
            <Filter size={16} aria-hidden />
            {t.assign.apply}
          </button>
        </div>
      </form>

      {/* Bulk result */}
      {s.result && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div>
            <p className="font-semibold">{t.assign.bulkDone(s.result.summary)}</p>
            <p className="mt-0.5 text-emerald-800">{t.assign.bulkEmail(s.result.summary)}</p>
          </div>
          <button type="button" onClick={s.clearResult} aria-label={t.actions.close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-emerald-100">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Results */}
      {s.state.status === 'loading' || s.state.status === 'idle' ? (
        <PromotionLoading />
      ) : s.state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(s.state.code)} onRetry={s.reload} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            <div className="flex items-center gap-1">
              {s.rows.length > 0 && <RowCheck on={s.allOnPageSelected} onClick={s.togglePage} label={t.assign.selectPage} />}
              <span className="text-sm font-semibold text-gray-900">{t.assign.results(page!.total)}</span>
            </div>
            {page!.excludedNoEmail > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                <MailWarning size={14} aria-hidden />
                {t.assign.excludedNoEmail(page!.excludedNoEmail)}
              </span>
            )}
          </div>

          {s.rows.length === 0 ? (
            <PromotionEmpty title={t.states.noResults} />
          ) : (
            <>
              <ul className="divide-y divide-gray-100 xl:hidden">
                {s.rows.map((c) => (
                  <CandidateCard key={c.id} c={c} on={s.selected.has(c.id)} onToggle={() => s.toggle(c.id)} />
                ))}
              </ul>
              <table className="hidden w-full text-left text-sm xl:table">
                <thead className="bg-gray-50/60 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="w-12 px-1" />
                    <th className="px-3 py-2 font-medium">{t.assign.cols.customer}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.assign.cols.visits}</th>
                    <th className="px-3 py-2 font-medium">{t.assign.cols.lastVisit}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.assign.cols.spent}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.assign.cols.qualifying}</th>
                    <th className="px-3 py-2 font-medium">{t.assign.nationality}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {s.rows.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => s.toggle(c.id)}
                      className={c.alreadyHasPass ? 'opacity-50' : `cursor-pointer ${s.selected.has(c.id) ? 'bg-indigo-50/60' : 'hover:bg-gray-50/60'}`}
                    >
                      <td className="px-1">
                        <RowCheck on={s.selected.has(c.id)} disabled={c.alreadyHasPass} onClick={() => s.toggle(c.id)} label={c.name} />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">
                          {c.name}
                          {c.alreadyHasPass && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">{t.assign.alreadyHasPass}</span>}
                        </p>
                        <p className="text-xs text-gray-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.visitCount}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatPromoDate(c.lastVisitAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{formatVnd(c.totalSpent)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.qualifyingOrderCount}</td>
                      <td className="px-3 py-2 text-gray-700">{c.nationality ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {page!.total > CANDIDATE_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-sm text-gray-600">
              <span>{t.pass.pageOf(s.offset + 1, Math.min(s.offset + CANDIDATE_PAGE_SIZE, page!.total), page!.total)}</span>
              <div className="flex gap-2">
                <button type="button" disabled={s.offset === 0} onClick={() => s.setOffset(Math.max(0, s.offset - CANDIDATE_PAGE_SIZE))} aria-label={t.pass.prevPage} className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 disabled:opacity-40">
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <button type="button" disabled={s.offset + CANDIDATE_PAGE_SIZE >= page!.total} onClick={() => s.setOffset(s.offset + CANDIDATE_PAGE_SIZE)} aria-label={t.pass.nextPage} className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 disabled:opacity-40">
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {s.issueError && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {promotionErrorMessage(s.issueError)}
        </p>
      )}

      {/* Contextual action: only appears once at least one customer is selected (1 = single issue). */}
      {/* pr-20 on phones keeps the button clear of the floating AI button (bottom-right). */}
      {s.selected.size > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-100 bg-white/95 py-3 pl-4 pr-20 shadow-lg shadow-indigo-900/10 backdrop-blur lg:pr-4">
          <div className="text-sm">
            <p className="font-semibold text-gray-900">{t.assign.selectedCount(s.selected.size)}</p>
            <p className="text-xs text-gray-500">{t.assign.maxPerIssue(BULK_ISSUE_MAX)}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={s.clearSelection} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100">
              {t.assign.clearSelection}
            </button>
            <button
              type="button"
              disabled={s.issuing}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {s.issuing && <Loader2 size={16} className="animate-spin" aria-hidden />}
              {s.selected.size === 1 ? t.assign.issueOne : t.assign.issueSelected(s.selected.size)}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t.assign.confirmTitle}
        message={t.assign.confirmMessage(s.selected.size, formatBenefit(campaign.benefit), campaign.name)}
        confirmText={t.assign.issueSelected(s.selected.size)}
        variant="warning"
        isLoading={s.issuing}
        onConfirm={async () => {
          await s.issue();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};

const CandidateCard = ({ c, on, onToggle }: { c: CustomerCandidate; on: boolean; onToggle: () => void }) => (
  <li onClick={onToggle} className={`flex items-start gap-1 px-1 py-2 ${c.alreadyHasPass ? 'opacity-50' : `cursor-pointer ${on ? 'bg-indigo-50/60' : ''}`}`}>
    <RowCheck on={on} disabled={c.alreadyHasPass} onClick={onToggle} label={c.name} />
    <div className="min-w-0 flex-1 py-2 pr-3">
      <p className="font-medium text-gray-900">
        {c.name}
        {c.alreadyHasPass && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">{t.assign.alreadyHasPass}</span>}
      </p>
      <p className="break-all text-xs text-gray-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
      <p className="mt-1 text-xs text-gray-600">
        {t.assign.cols.visits}: {c.visitCount} · {t.assign.cols.spent}: {formatVnd(c.totalSpent)} · {t.assign.cols.qualifying}: {c.qualifyingOrderCount}
      </p>
      <p className="text-xs text-gray-500">
        {t.assign.cols.lastVisit}: {formatPromoDate(c.lastVisitAt)}
        {c.nationality ? ` · ${c.nationality}` : ''}
      </p>
    </div>
  </li>
);

export default CustomerCandidatesPanel;
