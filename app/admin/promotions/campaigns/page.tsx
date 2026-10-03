'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import PromotionBenefitDisplay from '@/components/promotions/PromotionBenefitDisplay';
import PromotionStatusBadge from '@/components/promotions/PromotionStatusBadge';
import { PromotionEmpty, PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { t } from '@/components/promotions/promotion.i18n';
import { promotionApi } from '@/lib/services/promotionApi';
import { formatPromoDate, formatUsageType, promotionErrorMessage } from '@/lib/promotion-format';

const CampaignListPage = () => {
  const { state, reload } = usePromotionQuery(() => promotionApi.listCampaigns(), []);
  const rows = state.data ?? [];
  const showIssued = rows.some((c) => c.issuedPassCount != null);
  const showUsed = rows.some((c) => c.usageCount != null);

  return (
    <PromotionsShell title={t.campaign.listTitle}>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{t.campaign.listTitle}</h1>
      {state.status === 'loading' && !state.data ? (
        <PromotionLoading />
      ) : state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
      ) : rows.length === 0 ? (
        <PromotionEmpty
          action={
            <Link href={PROMOTION_PATHS.newCampaign} className="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">
              {t.actions.createPromotion}
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <ul className="divide-y divide-gray-100 xl:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={PROMOTION_PATHS.campaign(c.id)} className="flex items-center gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <PromotionStatusBadge kind="campaign" status={c.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
                      <PromotionBenefitDisplay benefit={c.benefit} size="sm" />
                      <span>{formatUsageType(c.usage)}</span>
                      <span>
                        {formatPromoDate(c.validFrom)} → {formatPromoDate(c.validUntil)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-gray-300" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-sm xl:table">
            <thead className="bg-gray-50/60 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t.campaign.cols.name}</th>
                <th className="px-4 py-3 font-medium">{t.campaign.cols.benefit}</th>
                <th className="px-4 py-3 font-medium">{t.campaign.cols.status}</th>
                <th className="px-4 py-3 font-medium">{t.campaign.cols.validFrom}</th>
                <th className="px-4 py-3 font-medium">{t.campaign.cols.validUntil}</th>
                <th className="px-4 py-3 font-medium">{t.campaign.cols.usageType}</th>
                {showIssued && <th className="px-4 py-3 text-right font-medium">{t.campaign.cols.issued}</th>}
                {showUsed && <th className="px-4 py-3 text-right font-medium">{t.campaign.cols.used}</th>}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="font-mono text-xs text-gray-500">{c.campaignCode}</p>
                  </td>
                  <td className="px-4 py-3">
                    <PromotionBenefitDisplay benefit={c.benefit} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <PromotionStatusBadge kind="campaign" status={c.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatPromoDate(c.validFrom)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatPromoDate(c.validUntil)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatUsageType(c.usage)}</td>
                  {showIssued && <td className="px-4 py-3 text-right text-gray-700">{c.issuedPassCount ?? '—'}</td>}
                  {showUsed && <td className="px-4 py-3 text-right text-gray-700">{c.usageCount ?? '—'}</td>}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link href={PROMOTION_PATHS.campaign(c.id)} className="rounded-lg px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50">
                      {t.actions.view}
                    </Link>
                    {c.status !== 'ENDED' && (
                      <Link href={PROMOTION_PATHS.editCampaign(c.id)} className="rounded-lg px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100">
                        {t.actions.edit}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PromotionsShell>
  );
};

export default CampaignListPage;
