'use client';

import React, { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { useParams } from 'next/navigation';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import { usePromotionAccess } from '@/components/promotions/usePromotionAccess';
import PromotionBenefitDisplay from '@/components/promotions/PromotionBenefitDisplay';
import PromotionStatusBadge from '@/components/promotions/PromotionStatusBadge';
import VoucherCard3D from '@/components/promotions/VoucherCard3D';
import { useSpaContact } from '@/components/promotions/useSpaContact';
import { voucherCardFromPass } from '@/components/promotions/VoucherCard3D.logic';
import QRCodeViewer from '@/components/promotions/QRCodeViewer';
import UsageHistoryList from '@/components/promotions/UsageHistoryList';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { useCancelUsage } from '@/components/promotions/useCancelUsage';
import { t } from '@/components/promotions/promotion.i18n';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { promotionApi } from '@/lib/services/promotionApi';
import { formatPromoDate, formatPromoDateTime, formatUsageType, formatUsedCount, promotionErrorMessage } from '@/lib/promotion-format';
import type { PassStatusAction, PromotionPassStatus } from '@/lib/types/promotion-client';

const ACTIONS_BY_STATUS: Record<PromotionPassStatus, PassStatusAction[]> = {
  ACTIVE: ['SUSPEND', 'CANCEL'],
  SUSPENDED: ['REACTIVATE', 'CANCEL'],
  EXPIRED: [],
  CANCELLED: [],
};

const ACTION_COPY: Record<PassStatusAction, { label: string; confirm: string; variant: 'normal' | 'warning' | 'danger' }> = {
  SUSPEND: { label: t.actions.suspend, confirm: t.pass.confirmSuspend, variant: 'warning' },
  CANCEL: { label: t.actions.cancel, confirm: t.pass.confirmCancel, variant: 'danger' },
  REACTIVATE: { label: t.actions.reactivate, confirm: t.pass.confirmReactivate, variant: 'normal' },
};

const PassDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { addToast } = useToast();
  const pass = usePromotionQuery(() => promotionApi.getPass(id), [id]);
  const spaContact = useSpaContact();
  const access = usePromotionAccess();
  const usages = usePromotionQuery(() => promotionApi.getUsageHistory({ passId: id }), [id]);
  const [qrOpen, setQrOpen] = useState(false);
  const [pending, setPending] = useState<PassStatusAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const cancel = useCancelUsage(() => {
    usages.reload();
    pass.reload();
  });

  const resendEmail = async () => {
    if (sending) return;
    setSending(true);
    const res = await promotionApi.sendPassEmail(id);
    setSending(false);
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    addToast(t.pass.emailResent, 'success');
    pass.reload();
  };

  const runAction = async () => {
    if (!pending) return;
    setBusy(true);
    const res = await promotionApi.setPassStatus(id, pending, reason.trim() || undefined);
    setBusy(false);
    setPending(null);
    setReason('');
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    addToast(t.pass.statusChanged, 'success');
    pass.reload();
  };

  const p = pass.state.data;

  return (
    <PromotionsShell action={'pass.view'} title={t.pass.detailTitle}>
      {pass.state.status === 'loading' && !p ? (
        <PromotionLoading />
      ) : pass.state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(pass.state.code)} onRetry={pass.reload} />
      ) : p ? (
        <div className="space-y-5">
          {/* 1. Voucher face first — staff compares it with the customer's e-voucher */}
          <section className="rounded-3xl border border-gray-100 bg-gradient-to-b from-white to-indigo-50/40 p-5 shadow-sm sm:p-8">
            <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-center lg:gap-10">
              <VoucherCard3D data={voucherCardFromPass(p)} contact={spaContact} className="shrink-0" />
              <div className="w-full min-w-0 flex-1 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.voucher.compareTitle}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900">{p.campaign.name}</h1>
                    <PromotionStatusBadge kind="pass" status={p.effectiveStatus} size="lg" />
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-500">{t.pass.fields.customer}</dt>
                    <dd className="font-medium text-gray-900">{[p.customer.name, p.customer.phone, p.customer.email].filter(Boolean).join(' · ')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t.pass.fields.voucherCode}</dt>
                    <dd className="font-mono font-semibold tracking-wider text-gray-900">{p.voucherCode}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t.pass.fields.benefit}</dt>
                    <dd>
                      <PromotionBenefitDisplay benefit={p.benefit} size="sm" />
                    </dd>
                  </div>
                  {p.emailStatus && (
                    <div className="col-span-2">
                      <dt className="text-xs text-gray-500">{t.pass.fields.email}</dt>
                      <dd className={`font-medium ${p.emailStatus === 'FAILED' ? 'text-rose-700' : p.emailStatus === 'SENT' ? 'text-emerald-700' : 'text-gray-700'}`}>
                        {t.pass.emailStatus[p.emailStatus] ?? p.emailStatus}
                        {p.emailTo && ` · ${p.emailTo}`}
                        {p.emailSentAt && ` · ${formatPromoDateTime(p.emailSentAt)}`}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={p.effectiveStatus !== 'ACTIVE'}
                    onClick={() => setQrOpen(true)}
                    className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t.actions.viewQr}
                  </button>
                  {access.issue && p.effectiveStatus === 'ACTIVE' && p.customer.email && (
                    <button
                      type="button"
                      onClick={resendEmail}
                      disabled={sending}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-700 disabled:opacity-50"
                    >
                      {sending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mail size={16} aria-hidden />}
                      {t.pass.resendEmail}
                    </button>
                  )}
                  {(access.issue ? ACTIONS_BY_STATUS[p.status] : []).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setPending(a)}
                      className={`min-h-11 rounded-xl border bg-white px-4 text-sm font-semibold ${a === 'CANCEL' ? 'border-rose-200 text-rose-700' : a === 'SUSPEND' ? 'border-amber-200 text-amber-700' : 'border-gray-200 text-gray-700'}`}
                    >
                      {ACTION_COPY[a].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 2. Promotion details */}
          <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
            <dl className="grid h-fit grid-cols-2 gap-4 rounded-2xl border border-gray-100 bg-white p-5 text-sm shadow-sm">
              <h2 className="col-span-2 font-semibold text-gray-900">{t.pass.detailTitle}</h2>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.fields.usageType}</dt>
                <dd className="font-medium">{formatUsageType(p.usage)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.fields.usedCount}</dt>
                <dd className="font-medium">{formatUsedCount(p.usage)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.fields.validFrom}</dt>
                <dd className="font-medium">{formatPromoDate(p.validFrom)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.fields.validUntil}</dt>
                <dd className="font-medium">{formatPromoDate(p.validUntil)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.fields.lastUsed}</dt>
                <dd className="font-medium">{p.lastUsedAt ? formatPromoDateTime(p.lastUsedAt) : t.pass.never}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.cols.issued}</dt>
                <dd className="font-medium">{formatPromoDateTime(p.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t.pass.fields.issueSource}</dt>
                <dd className="font-medium">{p.issueSource === 'AUTO' ? t.pass.issueSourceAuto : t.pass.issueSourceManual}</dd>
              </div>
              {p.sourceBookingId && (
                <div>
                  <dt className="text-xs text-gray-500">{t.pass.fields.sourceOrder}</dt>
                  <dd className="font-mono text-xs font-medium">{p.sourceBookingId}</dd>
                </div>
              )}
              {p.statusReason && (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-500">{t.pass.fields.statusReason}</dt>
                  <dd className="font-medium">{p.statusReason}</dd>
                </div>
              )}
            </dl>

            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-gray-900">{t.actions.usageHistory}</h2>
              {usages.state.status === 'loading' && !usages.state.data ? (
                <PromotionLoading />
              ) : usages.state.status === 'error' ? (
                <PromotionError message={promotionErrorMessage(usages.state.code)} onRetry={usages.reload} />
              ) : (
                <UsageHistoryList items={usages.state.data ?? []} compact onCancel={access.cancelUsage ? cancel.request : undefined} />
              )}
            </section>
          </div>

          <QRCodeViewer pass={p} open={qrOpen} onClose={() => setQrOpen(false)} />
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACTION_COPY[pending].label : ''}
        message={pending ? ACTION_COPY[pending].confirm : ''}
        confirmText={pending ? ACTION_COPY[pending].label : undefined}
        variant={pending ? ACTION_COPY[pending].variant : 'normal'}
        isLoading={busy}
        onConfirm={runAction}
        onCancel={() => setPending(null)}
      />
      {cancel.dialog}
    </PromotionsShell>
  );
};

export default PassDetailPage;
