'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Keyboard, Loader2, RefreshCw, ScanLine, Search, WifiOff } from 'lucide-react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import PromotionPassCard from '@/components/promotions/PromotionPassCard';
import OrderSelectCard from '@/components/promotions/OrderSelectCard';
import QRScanner from '@/components/promotions/QRScanner';
import { PromotionEmpty, PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { useAuth } from '@/lib/auth-context';
import { t } from '@/components/promotions/promotion.i18n';
import { formatBenefit, formatVnd, orderCode, passBlockedCode, promotionErrorMessage } from '@/lib/promotion-format';
import { OVERRIDE_NOTE_MAX, lookupFromUrl, useScanVoucher } from './ScanVoucher.logic';
import OverrideDialog from '@/components/promotions/OverrideDialog';

const secondaryBtn =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50';
const primaryBtn =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';

const ScanVoucher = () => {
  const params = useSearchParams();
  const router = useRouter();
  const s = useScanVoucher(lookupFromUrl(params));
  const { hasPermission } = useAuth();
  // Fixed target (not history.back): a QR deep link opens this page with no history to return to.
  const goBack = () => router.push(hasPermission('promotions') ? PROMOTION_PATHS.overview : PROMOTION_PATHS.dispatch);

  return (
      <div className="mx-auto max-w-md pb-28">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            aria-label={t.actions.back}
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
          >
            <ArrowLeft size={22} aria-hidden />
          </button>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            <ScanLine size={22} className="text-indigo-600" aria-hidden />
            {t.scan.title}
          </h1>
        </div>

        {s.step.name === 'scan' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 p-1" role="tablist">
              {(['camera', 'manual'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={s.mode === m}
                  onClick={() => s.setMode(m)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold ${s.mode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600'}`}
                >
                  {m === 'camera' ? <Camera size={16} aria-hidden /> : <Keyboard size={16} aria-hidden />}
                  {m === 'camera' ? t.actions.useCamera : t.actions.enterCodeManually}
                </button>
              ))}
            </div>

            {s.mode === 'camera' ? (
              <QRScanner onDecode={s.onDecode} />
            ) : (
              <form
                className="space-y-3 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  s.submitManual();
                }}
              >
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">{t.scan.manualTitle}</span>
                  <input
                    autoFocus
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    value={s.manualCode}
                    onChange={(e) => s.setManualCode(e.target.value)}
                    placeholder={t.scan.manualPlaceholder}
                    aria-invalid={s.manualError}
                    className={`min-h-14 w-full rounded-2xl border px-4 font-mono text-lg uppercase tracking-widest focus:outline-none focus:ring-2 ${
                      s.manualError ? 'border-rose-300 focus:ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-indigo-100'
                    }`}
                  />
                  {s.manualError && <span className="mt-1 block text-sm text-rose-600">{promotionErrorMessage('INVALID_QR')}</span>}
                </label>
                <button type="submit" className={primaryBtn} disabled={!s.manualCode.trim()}>
                  {t.actions.lookup}
                </button>
              </form>
            )}

            {s.mode === 'camera' && (
              <button type="button" onClick={() => s.setMode('manual')} className="w-full py-2 text-center text-sm font-medium text-indigo-600">
                {t.actions.enterCodeManually}
              </button>
            )}
          </div>
        )}

        {s.step.name === 'lookingUp' && <PromotionLoading label={t.scan.lookingUp} />}

        {s.step.name === 'lookupError' && (
          <div role="alert" className="space-y-4 rounded-3xl border border-rose-100 bg-rose-50/60 p-6 text-center">
            {s.step.code === 'NETWORK_ERROR' ? (
              <WifiOff size={40} className="mx-auto text-rose-500" aria-hidden />
            ) : (
              <AlertTriangle size={40} className="mx-auto text-rose-500" aria-hidden />
            )}
            <p className="text-lg font-semibold text-rose-800">{promotionErrorMessage(s.step.code)}</p>
            <div className="flex gap-2">
              {(s.step.code === 'NETWORK_ERROR' || s.step.code === 'UNKNOWN') && (
                <button type="button" onClick={s.retryLookup} className={secondaryBtn}>
                  <RefreshCw size={16} aria-hidden />
                  {t.actions.retry}
                </button>
              )}
              <button type="button" onClick={s.reset} className={secondaryBtn}>
                <ScanLine size={16} aria-hidden />
                {t.actions.scanAnother}
              </button>
            </div>
          </div>
        )}

        {s.step.name === 'found' && (
          <div className="space-y-5">
            <PromotionPassCard pass={s.step.pass} />

            {!s.passUsable ? (
              <div role="alert" className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="font-semibold text-gray-800">
                  {t.scan.notUsable}: {promotionErrorMessage(passBlockedCode(s.step.pass.effectiveStatus))}
                </p>
                <button type="button" onClick={s.reset} className={secondaryBtn}>
                  {t.actions.scanAnother}
                </button>
              </div>
            ) : (
              <section aria-labelledby="select-order">
                <h2 id="select-order" className="mb-2 font-semibold text-gray-900">
                  {t.scan.selectOrder}
                </h2>
                <label className="relative mb-3 block">
                  <span className="sr-only">{t.scan.orderSearchPlaceholder}</span>
                  <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
                  <input
                    type="search"
                    value={s.orderSearch}
                    onChange={(e) => s.setOrderSearch(e.target.value)}
                    placeholder={t.scan.orderSearchPlaceholder}
                    className="min-h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm focus:border-indigo-400 focus:outline-none"
                  />
                </label>

                {s.orders.status === 'loading' || s.orders.status === 'idle' ? (
                  <PromotionLoading />
                ) : s.orders.status === 'error' ? (
                  <PromotionError message={promotionErrorMessage(s.orders.code)} onRetry={s.reloadOrders} />
                ) : s.orders.orders.length === 0 ? (
                  <PromotionEmpty title={s.orderSearch ? t.states.noResults : t.scan.noOrders} hint={s.orderSearch ? undefined : t.scan.noOrdersHint} />
                ) : (
                  <div role="radiogroup" aria-labelledby="select-order" className="space-y-4">
                    {[
                      { label: t.scan.ownerOrders, rows: s.orders.orders.filter((o) => o.isPassOwnerOrder) },
                      { label: t.scan.otherOrders, rows: s.orders.orders.filter((o) => !o.isPassOwnerOrder) },
                    ]
                      .filter((g) => g.rows.length > 0)
                      .map((g) => (
                        <div key={g.label} className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</p>
                          {g.rows.map((o) => (
                            <OrderSelectCard key={o.id} order={o} selected={s.selectedOrderId === o.id} onSelect={s.selectOrder} />
                          ))}
                        </div>
                      ))}
                  </div>
                )}
              </section>
            )}

            {s.passUsable && (
              <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
                <div className="mx-auto max-w-md space-y-2">
                  {s.applyError && (
                    <p role="alert" className="text-center text-sm font-medium text-rose-600">
                      {promotionErrorMessage(s.applyError)}
                    </p>
                  )}
                  <button type="button" className={primaryBtn} disabled={!s.selectedOrderId || s.applying} onClick={s.apply} aria-busy={s.applying}>
                    {s.applying ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
                    {s.applying ? t.scan.applying : s.selectedNeedsOverride ? t.scan.applyOverride : t.scan.applyTo(formatBenefit(s.step.pass.benefit))}
                  </button>
                  <button type="button" onClick={s.reset} className="w-full py-1 text-sm font-medium text-gray-500">
                    {t.actions.scanAnother}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {s.step.name === 'success' && (
          <div className="space-y-5">
            <div role="status" className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-6 text-center">
              <CheckCircle2 size={48} className="mx-auto text-emerald-600" aria-hidden />
              <p className="mt-3 text-lg font-semibold text-emerald-900">{t.scan.successTitle}</p>
              <p className="mt-1 font-mono text-sm text-emerald-800">{orderCode(s.step.result.booking)}</p>
              <p className="mt-2 text-sm text-emerald-800">
                {s.step.result.discountAmount ? t.scan.successDiscount(formatVnd(s.step.result.discountAmount)) : t.scan.successAdded(formatBenefit(s.step.pass.benefit))}
              </p>
              {s.step.result.conditionsOverridden && (
                <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                  <AlertTriangle size={14} aria-hidden />
                  {t.scan.overriddenDone}
                </p>
              )}
            </div>

            <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <ul className="divide-y divide-gray-100 text-sm">
                {s.step.result.booking.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium text-gray-900">
                        {it.isPromotion && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{t.order.promoTag}</span>}
                        <span className="truncate">{it.serviceName}</span>
                      </span>
                      <span className="text-xs text-gray-500">{t.order.minutes(it.durationMinutes)}</span>
                    </span>
                    <span className="shrink-0 text-gray-700">{formatVnd(it.price)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-3 font-semibold text-gray-900">
                <span>{t.scan.totalDuration}</span>
                <span>{t.order.minutes(s.step.result.booking.totalDurationMinutes)}</span>
              </div>
            </section>

            <div className="flex gap-2">
              <Link href={PROMOTION_PATHS.dispatch} className={secondaryBtn}>
                {t.actions.viewOrder}
              </Link>
              <button type="button" onClick={s.reset} className={secondaryBtn}>
                <ScanLine size={16} aria-hidden />
                {t.actions.scanAnother}
              </button>
            </div>
          </div>
        )}
        <OverrideDialog
          open={!!s.override}
          reasons={s.override?.reasons ?? []}
          note={s.override?.note ?? ''}
          maxLength={OVERRIDE_NOTE_MAX}
          error={s.override?.error ?? null}
          submitting={!!s.override?.submitting}
          onNoteChange={s.setOverrideNote}
          onConfirm={s.confirmOverride}
          onClose={s.closeOverride}
        />
      </div>
  );
};

const ScanVoucherPage = () => (
  <PromotionsShell title={t.scan.title} bare permission="dispatch_board">
    <Suspense fallback={<PromotionLoading />}>
      <ScanVoucher />
    </Suspense>
  </PromotionsShell>
);

export default ScanVoucherPage;
