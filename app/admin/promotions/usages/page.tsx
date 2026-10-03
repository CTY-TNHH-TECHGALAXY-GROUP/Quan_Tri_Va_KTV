'use client';

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import UsageHistoryList from '@/components/promotions/UsageHistoryList';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { useCancelUsage } from '@/components/promotions/useCancelUsage';
import { USAGE_STATUS_LABEL, t } from '@/components/promotions/promotion.i18n';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';
import type { PromotionUsageStatus, UsageListFilter } from '@/lib/types/promotion-client';

// 🔧 UI CONFIGURATION
const SEARCH_DEBOUNCE_MS = 300;
const USAGE_STATUSES = Object.keys(USAGE_STATUS_LABEL) as PromotionUsageStatus[];

const controlClass = 'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none';

const UsageHistoryPage = () => {
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState<UsageListFilter>({});

  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => ({ ...f, search: searchInput.trim() || undefined })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const campaigns = usePromotionQuery(() => promotionApi.listCampaigns(), []);
  const { state, reload } = usePromotionQuery(
    () => promotionApi.getUsageHistory(filter),
    [filter.search, filter.campaignId, filter.status, filter.dateFrom, filter.dateTo],
  );
  const cancel = useCancelUsage(reload);

  return (
    <PromotionsShell title={t.usage.listTitle}>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{t.usage.listTitle}</h1>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <label className="relative sm:col-span-2 xl:col-span-1">
          <span className="sr-only">{t.usage.searchPlaceholder}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
          <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={t.usage.searchPlaceholder} className={`${controlClass} pl-10`} />
        </label>
        <input type="date" aria-label={t.usage.dateFrom} className={controlClass} value={filter.dateFrom ?? ''} onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value || undefined }))} />
        <input type="date" aria-label={t.usage.dateTo} className={controlClass} value={filter.dateTo ?? ''} onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value || undefined }))} />
        <select aria-label={t.usage.cols.promotion} className={controlClass} value={filter.campaignId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, campaignId: e.target.value || undefined }))}>
          <option value="">{t.pass.filterAllCampaigns}</option>
          {(campaigns.state.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label={t.usage.cols.status} className={controlClass} value={filter.status ?? ''} onChange={(e) => setFilter((f) => ({ ...f, status: (e.target.value || undefined) as PromotionUsageStatus | undefined }))}>
          <option value="">{t.pass.filterAllStatuses}</option>
          {USAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {USAGE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white px-4 py-2 shadow-sm">
        {state.status === 'loading' && !state.data ? (
          <PromotionLoading />
        ) : state.status === 'error' ? (
          <div className="py-4">
            <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
          </div>
        ) : (
          <UsageHistoryList items={state.data ?? []} onCancel={cancel.request} />
        )}
      </div>
      {cancel.dialog}
    </PromotionsShell>
  );
};

export default UsageHistoryPage;
