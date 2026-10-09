'use client';

import React, { useState } from 'react';
import { Globe, PauseCircle, PlayCircle, Radio, Settings2, ShieldAlert, X } from 'lucide-react';
import { t } from '@/components/promotions/promotion.i18n';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { formatPromoDateTime, formatVnd, promotionErrorMessage } from '@/lib/promotion-format';
import type { WebClaimConfigInput, WebClaimRecord, WebClaimStats, WebClaimStatus } from '@/lib/types/promotion-client';
import {
  useWebClaim,
  validateWebClaimForm,
  webClaimFormFrom,
  type WebClaimForm,
  type WebClaimFormErrors,
} from './CampaignWebClaimCard.logic';

// 🔧 UI CONFIGURATION
const REASON_MIN = 3;
const REASON_MAX = 300;
const STATUS_FILTERS: (WebClaimStatus | undefined)[] = [undefined, 'RESERVED', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED'];

const inputClass = (hasError?: boolean) =>
  `min-h-11 w-full rounded-xl border bg-white px-3 text-sm focus:outline-none focus:ring-2 ${
    hasError ? 'border-rose-300 focus:ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-indigo-100'
  }`;

const STOCK_TONE: Record<string, string> = {
  OPEN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-700 border-amber-200',
  SOLD_OUT: 'bg-rose-50 text-rose-700 border-rose-200',
  ENDED: 'bg-gray-100 text-gray-600 border-gray-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
};

const CLAIM_TONE: Record<WebClaimStatus, string> = {
  RESERVED: 'bg-amber-50 text-amber-700',
  ACTIVE: 'bg-indigo-50 text-indigo-700',
  REDEEMED: 'bg-emerald-50 text-emerald-700',
  EXPIRED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-rose-50 text-rose-700',
};

const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
    {children}
    {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
  </label>
);

const Stat = ({ label, value, tone = 'text-gray-900' }: { label: string; value: number | string; tone?: string }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
    <p className="text-xs text-gray-500">{label}</p>
    <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
  </div>
);

const ConfigForm = ({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: WebClaimForm;
  saving: boolean;
  onCancel?: () => void;
  onSave: (form: WebClaimForm, setErrors: (e: WebClaimFormErrors) => void) => void;
}) => {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<WebClaimFormErrors>({});
  const f = t.webClaim.fields;
  const set = (k: keyof WebClaimForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="mt-4 grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form, setErrors);
      }}
    >
      <Field label={f.totalQuantity} hint={f.totalQuantityHint} error={errors.totalQuantity}>
        <input inputMode="numeric" className={inputClass(!!errors.totalQuantity)} value={form.totalQuantity} onChange={set('totalQuantity')} />
      </Field>
      <Field label={f.reservationMinutes} hint={f.reservationMinutesHint} error={errors.reservationMinutes}>
        <input inputMode="numeric" className={inputClass(!!errors.reservationMinutes)} value={form.reservationMinutes} onChange={set('reservationMinutes')} />
      </Field>
      <Field label={f.maxOpenPerPhone} hint={f.maxOpenPerPhoneHint} error={errors.maxOpenPerPhone}>
        <input inputMode="numeric" className={inputClass(!!errors.maxOpenPerPhone)} value={form.maxOpenPerPhone} onChange={set('maxOpenPerPhone')} />
      </Field>
      <Field label={f.maxTotalPerPhone} hint={f.maxTotalPerPhoneHint} error={errors.maxTotalPerPhone}>
        <input inputMode="numeric" className={inputClass(!!errors.maxTotalPerPhone)} value={form.maxTotalPerPhone} onChange={set('maxTotalPerPhone')} />
      </Field>
      <div className="sm:col-span-2">
        <Field label={f.publicSlug} hint={f.publicSlugHint} error={errors.publicSlug}>
          <input className={`${inputClass(!!errors.publicSlug)} font-mono`} value={form.publicSlug} onChange={set('publicSlug')} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {t.webClaim.save}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            {t.webClaim.cancel}
          </button>
        )}
      </div>
    </form>
  );
};

/** Reason is mandatory for a release, so a tiny dialog with a text field (ConfirmDialog has none). */
const ReleaseDialog = ({
  message,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) => {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-gray-900">{t.webClaim.releaseOne}</h3>
          <button type="button" onClick={onCancel} className="-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-50" aria-label={t.webClaim.cancel}>
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">{t.webClaim.releaseReason}</span>
          <textarea rows={3} maxLength={REASON_MAX} className={`${inputClass()} py-2`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            {t.webClaim.cancel}
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => onConfirm(reason.trim())}
            className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {t.webClaim.releaseOne}
          </button>
        </div>
      </div>
    </div>
  );
};

const ClaimRow = ({ c, canRelease, onRelease }: { c: WebClaimRecord; canRelease: boolean; onRelease: (c: WebClaimRecord) => void }) => {
  const cols = t.webClaim.cols;
  const ended = c.endReason ? t.webClaim.endReason[c.endReason] ?? c.endReason : null;
  return (
    <li className="rounded-xl border border-gray-100 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-gray-900">{c.voucherCode}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CLAIM_TONE[c.status]}`}>{t.webClaim.claimStatus[c.status]}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-gray-500">{cols.reservedAt}</dt><dd className="text-gray-800">{formatPromoDateTime(c.reservedAt)}</dd></div>
        {c.status === 'RESERVED' && <div><dt className="text-gray-500">{cols.expiresAt}</dt><dd className="text-gray-800">{formatPromoDateTime(c.expiresAt)}</dd></div>}
        {c.activatedAt && <div><dt className="text-gray-500">{cols.activatedAt}</dt><dd className="text-gray-800">{formatPromoDateTime(c.activatedAt)}</dd></div>}
        {c.bookingId && <div><dt className="text-gray-500">{cols.booking}</dt><dd className="font-mono text-gray-800">{c.bookingId}</dd></div>}
        {(c.customerName || c.phone) && <div><dt className="text-gray-500">{cols.customer}</dt><dd className="text-gray-800">{[c.customerName, c.phone].filter(Boolean).join(' · ')}</dd></div>}
        {c.discountAmount != null && <div><dt className="text-gray-500">{cols.discount}</dt><dd className="text-gray-800">{formatVnd(c.discountAmount)}</dd></div>}
        {ended && <div><dt className="text-gray-500">{cols.ended}</dt><dd className="text-gray-800">{ended}</dd></div>}
      </dl>
      {canRelease && c.status === 'RESERVED' && (
        <button type="button" onClick={() => onRelease(c)} className="mt-2 min-h-11 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">
          {t.webClaim.releaseOne}
        </button>
      )}
    </li>
  );
};

interface CampaignWebClaimCardProps {
  campaignId: string;
  campaignName: string;
  canManage: boolean;
}

/** Limited e-vouchers saved by customers on Web Booking (engine v15): config, live stock, controls, list. */
const CampaignWebClaimCard = ({ campaignId, campaignName, canManage }: CampaignWebClaimCardProps) => {
  const { addToast } = useToast();
  const { state, reload, live, statusFilter, setStatusFilter, configure, setPaused, release } = useWebClaim(campaignId);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<'ALL' | WebClaimRecord | null>(null);
  const [confirmEnable, setConfirmEnable] = useState<WebClaimConfigInput | null>(null);
  const [busy, setBusy] = useState(false);

  const stats: WebClaimStats | null = state.data?.stats ?? null;
  // DB without engine v15: nothing to show, and the rest of the page must stay clean.
  if (state.status === 'error' && state.code === 'FEATURE_UNAVAILABLE') return null;
  const enabled = stats?.distributionChannel === 'WEB_CLAIM';
  const ended = stats?.campaignStatus === 'ENDED';

  const submitConfig = async (input: WebClaimConfigInput) => {
    setSaving(true);
    const res = await configure(input);
    setSaving(false);
    setConfirmEnable(null);
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    setEditing(false);
    addToast(t.webClaim.saved, 'success');
  };

  const save = (form: WebClaimForm, setErrors: (e: WebClaimFormErrors) => void) => {
    const { errors, input } = validateWebClaimForm(form);
    setErrors(errors);
    if (!input) return;
    // Turning a campaign into a web campaign cannot be undone: ask once.
    if (!enabled) setConfirmEnable(input);
    else void submitConfig(input);
  };

  const togglePause = async () => {
    if (!stats) return;
    setBusy(true);
    const next = !stats.paused;
    const res = await setPaused(next);
    setBusy(false);
    setConfirmPause(false);
    if (!res.success) addToast(promotionErrorMessage(res.error.code), 'error');
    else addToast(next ? t.webClaim.paused : t.webClaim.resumed, 'success');
  };

  const doRelease = async (reason: string) => {
    if (!releaseTarget) return;
    setBusy(true);
    const res = await release(reason, releaseTarget === 'ALL' ? undefined : releaseTarget.id);
    setBusy(false);
    setReleaseTarget(null);
    if (!res.success) addToast(promotionErrorMessage(res.error.code), 'error');
    else addToast(t.webClaim.released(res.data.released), 'success');
  };

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Globe size={20} />
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">{t.webClaim.title}</h2>
            <p className="text-sm text-gray-500">{t.webClaim.subtitle}</p>
          </div>
        </div>
        {enabled && stats?.stockStatus && (
          <div className="flex items-center gap-2">
            {live && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                <Radio size={14} className="animate-pulse" /> {t.webClaim.live}
              </span>
            )}
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STOCK_TONE[stats.stockStatus]}`}>
              {t.webClaim.stockStatus[stats.stockStatus]}
            </span>
          </div>
        )}
      </div>

      {state.status === 'loading' && !state.data ? (
        <PromotionLoading />
      ) : state.status === 'error' && !state.data ? (
        <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
      ) : stats && !enabled ? (
        <div className="mt-4">
          <p className="text-sm text-gray-600">{t.webClaim.notEnabled}</p>
          {stats.webIneligibleReason && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t.webClaim.ineligible[stats.webIneligibleReason]}
            </p>
          )}
          {canManage && !ended && !stats.webIneligibleReason && (editing ? (
            <ConfigForm initial={webClaimFormFrom(stats, campaignName)} saving={saving} onCancel={() => setEditing(false)} onSave={save} />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="mt-3 min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700">
              {t.webClaim.enable}
            </button>
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label={t.webClaim.stats.total} value={stats.total ?? 0} />
            <Stat label={t.webClaim.stats.available} value={stats.available ?? 0} tone={stats.available === 0 ? 'text-rose-600' : 'text-emerald-600'} />
            <Stat label={t.webClaim.stats.reserved} value={stats.reserved} tone="text-amber-600" />
            <Stat label={t.webClaim.stats.active} value={stats.active} tone="text-indigo-600" />
            <Stat label={t.webClaim.stats.redeemed} value={stats.redeemed} />
            <Stat label={t.webClaim.stats.expired} value={stats.expired} tone="text-gray-500" />
            <Stat label={t.webClaim.stats.cancelled} value={stats.cancelled} tone="text-gray-500" />
          </div>
          {stats.staleActive > 0 && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t.webClaim.staleActive(stats.staleActive)}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            {t.webClaim.fields.publicSlug}: <span className="font-mono">{stats.publicSlug}</span> · {t.webClaim.fields.reservationMinutes}: {stats.reservationMinutes} · {t.webClaim.fields.maxOpenPerPhone}: {stats.maxOpenPerPhone}
            {stats.maxTotalPerPhone != null && ` · ${t.webClaim.fields.maxTotalPerPhone}: ${stats.maxTotalPerPhone}`}
          </p>

          {canManage && !ended && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => (stats.paused ? void togglePause() : setConfirmPause(true))}
                disabled={busy}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${
                  stats.paused ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-amber-200 text-amber-700 hover:bg-amber-50'
                }`}
              >
                {stats.paused ? <PlayCircle size={18} /> : <PauseCircle size={18} />}
                {stats.paused ? t.webClaim.resume : t.webClaim.pause}
              </button>
              <button
                type="button"
                onClick={() => setReleaseTarget('ALL')}
                disabled={busy || stats.reserved === 0}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <ShieldAlert size={18} /> {t.webClaim.releaseAll}
              </button>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Settings2 size={18} /> {t.webClaim.editConfig}
              </button>
            </div>
          )}
          {editing && <ConfigForm initial={webClaimFormFrom(stats, campaignName)} saving={saving} onCancel={() => setEditing(false)} onSave={save} />}

          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t.webClaim.listTitle}</h3>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s ?? 'ALL'}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`min-h-11 rounded-full px-3 text-xs font-semibold ${
                      statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {s ? t.webClaim.claimStatus[s] : t.webClaim.filterAll}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">{t.webClaim.activeRevokeHint}</p>
            {state.data && state.data.claims.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">{t.webClaim.empty}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {state.data?.claims.map((c) => (
                  <ClaimRow key={c.id} c={c} canRelease={canManage && !ended} onRelease={setReleaseTarget} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmPause}
        title={t.webClaim.pause}
        message={t.webClaim.pauseConfirm}
        confirmText={t.webClaim.pause}
        variant="warning"
        isLoading={busy}
        onConfirm={togglePause}
        onCancel={() => setConfirmPause(false)}
      />
      <ConfirmDialog
        open={confirmEnable !== null}
        title={t.webClaim.enableConfirmTitle}
        message={t.webClaim.enableConfirm}
        confirmText={t.webClaim.enable}
        variant="warning"
        isLoading={saving}
        onConfirm={() => confirmEnable && void submitConfig(confirmEnable)}
        onCancel={() => setConfirmEnable(null)}
      />
      {releaseTarget && (
        <ReleaseDialog
          message={releaseTarget === 'ALL' ? t.webClaim.releaseAllConfirm : t.webClaim.releaseOneConfirm(releaseTarget.voucherCode)}
          busy={busy}
          onConfirm={doRelease}
          onCancel={() => setReleaseTarget(null)}
        />
      )}
    </section>
  );
};

export default CampaignWebClaimCard;
