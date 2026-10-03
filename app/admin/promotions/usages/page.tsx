'use client';

import React, { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import UsageHistoryList from '@/components/promotions/UsageHistoryList';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { useCancelUsage } from '@/components/promotions/useCancelUsage';
import { DateControl, FilterField, SelectControl } from '@/components/promotions/FormControls';
import { USAGE_STATUS_LABEL, t } from '@/components/promotions/promotion.i18n';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';
import type { PromotionUsageStatus, UsageListFilter } from '@/lib/types/promotion-client';

// 🔧 UI CONFIGURATION
const SEARCH_DEBOUNCE_MS = 300;
const USAGE_STATUSES = Object.keys(USAGE_STATUS_LABEL) as PromotionUsageStatus[];

const controlClass = 'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

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
    [filter.search, filter.campaignId, filter.status, filter.dateFrom, filter.dateTo, filter.overridden],
  );
  const cancel = useCancelUsage(reload);

  return (
    <PromotionsShell title={t.usage.listTitle}>
      <h1 className="text-xl font-semibold text-gray-900">{t.usage.listTitle}</h1>
      <p className="mb-4 mt-1 text-sm text-gray-500">{t.usage.listSubtitle}</p>
      <div className="mb-4 space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="relative block">
          <span className="sr-only">{t.usage.searchPlaceholder}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
          <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={t.usage.searchPlaceholder} className={`${controlClass} pl-10`} />
        </label>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <FilterField label={t.usage.dateFrom}>
            <DateControl value={filter.dateFrom ?? ''} max={filter.dateTo} onChange={(v) => setFilter((f) => ({ ...f, dateFrom: v || undefined }))} />
          </FilterField>
          <FilterField label={t.usage.dateTo}>
            <DateControl value={filter.dateTo ?? ''} min={filter.dateFrom} onChange={(v) => setFilter((f) => ({ ...f, dateTo: v || undefined }))} />
          </FilterField>
          <FilterField label={t.usage.cols.promotion}>
            <SelectControl value={filter.campaignId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, campaignId: e.target.value || undefined }))}>
              <option value="">{t.pass.filterAllCampaigns}</option>
              {(campaigns.state.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectControl>
          </FilterField>
          <FilterField label={t.usage.cols.status}>
            <SelectControl value={filter.status ?? ''} onChange={(e) => setFilter((f) => ({ ...f, status: (e.target.value || undefined) as PromotionUsageStatus | undefined }))}>
              <option value="">{t.pass.filterAllStatuses}</option>
              {USAGE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {USAGE_STATUS_LABEL[st]}
                </option>
              ))}
            </SelectControl>
          </FilterField>
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={!!filter.overridden}
          onClick={() => setFilter((f) => ({ ...f, overridden: !f.overridden || undefined }))}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-gray-800"
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${filter.overridden ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300 bg-white'}`} aria-hidden>
            {filter.overridden && <Check size={14} />}
          </span>
          {t.usage.onlyOverridden}
        </button>
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
