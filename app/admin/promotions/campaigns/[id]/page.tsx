'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import PromotionBenefitDisplay from '@/components/promotions/PromotionBenefitDisplay';
import PromotionStatusBadge from '@/components/promotions/PromotionStatusBadge';
import CustomerCandidatesPanel from '@/components/promotions/CustomerCandidatesPanel';
import VoucherCard3D from '@/components/promotions/VoucherCard3D';
import { voucherCardFromCampaign } from '@/components/promotions/VoucherCard3D.logic';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { ASSIGNMENT_LABEL, QUALIFICATION_LABEL, t } from '@/components/promotions/promotion.i18n';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { promotionApi } from '@/lib/services/promotionApi';
import { formatPromoDate, formatUsageType, promotionErrorMessage } from '@/lib/promotion-format';
import type { CampaignStatusAction, PromotionCampaignStatus } from '@/lib/types/promotion-client';

const ACTIONS_BY_STATUS: Record<PromotionCampaignStatus, CampaignStatusAction[]> = {
  DRAFT: ['ACTIVATE'],
  ACTIVE: ['DEACTIVATE', 'END'],
  INACTIVE: ['ACTIVATE', 'END'],
  ENDED: [],
};

const ACTION_COPY: Record<CampaignStatusAction, { label: string; confirm: string; variant: 'normal' | 'warning' | 'danger' }> = {
  ACTIVATE: { label: t.actions.activate, confirm: t.campaign.confirmActivate, variant: 'normal' },
  DEACTIVATE: { label: t.actions.deactivate, confirm: t.campaign.confirmDeactivate, variant: 'warning' },
  END: { label: t.actions.end, confirm: t.campaign.confirmEnd, variant: 'danger' },
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd className="mt-0.5 font-medium text-gray-900">{children}</dd>
  </div>
);

const CampaignDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { addToast } = useToast();
  const { state, reload, setData } = usePromotionQuery(() => promotionApi.getCampaign(id), [id]);
  const menus = usePromotionQuery(() => promotionApi.getMenus(), []);
  const menuLabel = (code: string) => menus.state.data?.find((m) => m.code === code)?.label ?? code;
  const [pending, setPending] = useState<CampaignStatusAction | null>(null);
  const [busy, setBusy] = useState(false);

  const runAction = async () => {
    if (!pending) return;
    setBusy(true);
    const res = await promotionApi.setCampaignStatus(id, pending);
    setBusy(false);
    setPending(null);
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    setData(res.data);
    addToast(t.campaign.statusChanged, 'success');
  };

  return (
    <PromotionsShell title={t.campaign.detailTitle}>
      {state.status === 'loading' && !state.data ? (
        <PromotionLoading />
      ) : state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
      ) : state.data ? (
        (() => {
          const c = state.data;
          return (
            <div className="space-y-5">
            <section className="flex flex-col items-center gap-3 rounded-3xl border border-gray-100 bg-gradient-to-b from-white to-indigo-50/40 p-5 shadow-sm sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.voucher.previewTitle}</p>
              <VoucherCard3D data={voucherCardFromCampaign(c, menuLabel)} />
              <p className="text-center text-xs text-gray-500">{t.voucher.previewHint}</p>
            </section>
            <div className="space-y-5">
              <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-semibold text-gray-900">{c.name}</h1>
                    <p className="font-mono text-xs text-gray-500">{c.campaignCode}</p>
                  </div>
                  <PromotionStatusBadge kind="campaign" status={c.status} size="lg" />
                </div>
                {c.description && <p className="mt-3 text-sm text-gray-600">{c.description}</p>}
                <div className="mt-4">
                  <PromotionBenefitDisplay benefit={c.benefit} size="xl" />
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                  <Row label={t.campaign.cols.validFrom}>{formatPromoDate(c.validFrom)}</Row>
                  <Row label={t.campaign.cols.validUntil}>{formatPromoDate(c.validUntil)}</Row>
                  <Row label={t.campaign.cols.usageType}>{formatUsageType(c.usage)}</Row>
                  <Row label={t.form.qualificationType}>
                    {QUALIFICATION_LABEL[c.qualification.type]}
                    {c.qualification.type === 'MIN_PAID_DURATION' && c.qualification.value ? ` ≥ ${c.qualification.value} phút` : ''}
                  </Row>
                  <Row label={t.form.validityType}>
                    {c.validity?.type === 'DAYS_FROM_ISSUE' && c.validity.days ? `${c.validity.days} ngày kể từ ngày phát` : t.form.validityCampaign}
                  </Row>
                  <Row label={t.form.applicableMenus}>
                    {c.applicableMenus && !c.applicableMenus.allMenus && c.applicableMenus.menus.length ? c.applicableMenus.menus.map(menuLabel).join(', ') : t.campaign.allMenus}
                  </Row>
                  <Row label={t.form.assignmentMode}>{ASSIGNMENT_LABEL[c.assignmentMode]}</Row>
                  <Row label={t.form.voucherPrefix}>
                    <span className="font-mono">{c.voucherPrefix}</span>
                  </Row>
                  {c.issuedPassCount != null && <Row label={t.campaign.cols.issued}>{c.issuedPassCount}</Row>}
                  {c.usageCount != null && <Row label={t.campaign.cols.used}>{c.usageCount}</Row>}
                </dl>

                <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                  {c.status !== 'ENDED' && (
                    <Link href={PROMOTION_PATHS.editCampaign(c.id)} className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                      {t.actions.edit}
                    </Link>
                  )}
                  {ACTIONS_BY_STATUS[c.status].map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setPending(a)}
                      className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${
                        a === 'ACTIVATE' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : a === 'END' ? 'border border-rose-200 text-rose-700 hover:bg-rose-50' : 'border border-amber-200 text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      {ACTION_COPY[a].label}
                    </button>
                  ))}
                  <Link href={`${PROMOTION_PATHS.passes}?campaignId=${encodeURIComponent(c.id)}`} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">
                    {t.nav.passes}
                  </Link>
                </div>
              </section>

              {c.status !== 'ENDED' && (
                <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                  <h2 className="mb-3 font-semibold text-gray-900">{t.assign.title}</h2>
                  <CustomerCandidatesPanel campaign={c} />
                </section>
              )}
            </div>
            </div>
          );
        })()
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
    </PromotionsShell>
  );
};

export default CampaignDetailPage;
