'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, Search } from 'lucide-react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import PromotionStatusBadge from '@/components/promotions/PromotionStatusBadge';
import { PromotionEmpty, PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { t } from '@/components/promotions/promotion.i18n';
import { promotionApi } from '@/lib/services/promotionApi';
import { formatPromoDate, formatUsedCount, promotionErrorMessage } from '@/lib/promotion-format';
import type { PassGroup, PassListFilter, PromotionOverviewStats, PromotionPass, PromotionPassWithQr } from '@/lib/types/promotion-client';
import { CalendarClock, ChevronLeft } from 'lucide-react';
import { SelectControl } from '@/components/promotions/FormControls';
import VoucherCardSwitchable from '@/components/promotions/VoucherCardSwitchable';
import { useSpaContact } from '@/components/promotions/useSpaContact';
import { voucherCardFromPass } from '@/components/promotions/VoucherCard3D.logic';

// 🔧 UI CONFIGURATION
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;
const GROUPS: { id: PassGroup; label: string; hint: string; count: (o: PromotionOverviewStats) => number | undefined }[] = [
  { id: 'ACTIVE', label: t.pass.groupActive, hint: t.pass.groupActiveHint, count: (o) => o.activePasses },
  { id: 'PAST', label: t.pass.groupPast, hint: t.pass.groupPastHint, count: (o) => o.pastPasses },
];
const isGroup = (v: string | null): v is PassGroup => v === 'ACTIVE' || v === 'PAST';


/** Status + "re-issued" tag for closed passes that were replaced by a new one. */
const PassBadge = ({ p }: { p: PromotionPass }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    <PromotionStatusBadge kind="pass" status={p.effectiveStatus} />
    {p.supersededAt && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t.pass.superseded}</span>}
  </span>
);

/** Past tab shows when the pass ended; active tab shows when it expires. */
const endDate = (p: PromotionPass, past: boolean) => formatPromoDate(past ? (p.endedAt ?? p.validUntil) : p.validUntil);

const PassList = () => {
  const params = useSearchParams();
  const [searchInput, setSearchInput] = useState('');
  const tabParam = params.get('tab')?.toUpperCase() ?? null;
  const [filter, setFilter] = useState<PassListFilter>({
    campaignId: params.get('campaignId') ?? undefined,
    group: isGroup(tabParam) ? tabParam : 'ACTIVE',
  });
  const setGroup = (group: PassGroup) => setFilter((f) => ({ ...f, group, expiry: undefined, offset: 0 }));
  const toggleExpiring = () => setFilter((f) => ({ ...f, expiry: f.expiry === 'EXPIRING_7D' ? undefined : 'EXPIRING_7D', offset: 0 }));

  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => ({ ...f, search: searchInput.trim() || undefined, offset: 0 })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const campaigns = usePromotionQuery(() => promotionApi.listCampaigns(), []);
  const { state, reload } = usePromotionQuery(
    () => promotionApi.getPasses({ ...filter, limit: PAGE_SIZE }),
    [filter.search, filter.campaignId, filter.group, filter.expiry, filter.offset],
  );
  // Tab counts come from the overview (engine v5: activePasses / pastPasses).
  const overview = usePromotionQuery(() => promotionApi.getOverview(), []);
  const past = filter.group === 'PAST';
  const rows = state.data?.rows ?? [];
  const total = state.data?.total ?? 0;
  const offset = filter.offset ?? 0;
  const setPage = (next: number) => setFilter((f) => ({ ...f, offset: next }));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Desktop preview: keep the selection while it is still in the list, else show the first row.
  useEffect(() => {
    if (state.status !== 'success') return;
    setSelectedId((prev) => (prev && state.data.rows.some((p) => p.id === prev) ? prev : (state.data.rows[0]?.id ?? null)));
  }, [state]);

  const spaContact = useSpaContact();
  const preview = usePromotionQuery<PromotionPassWithQr | null>(
    () => (selectedId ? promotionApi.getPass(selectedId) : Promise.resolve({ success: true as const, data: null })),
    [selectedId],
  );

  return (
    <>
      <h1 className="text-xl font-semibold text-gray-900">{t.pass.listTitle}</h1>
      <p className="mb-4 mt-1 text-sm text-gray-500">{t.pass.listSubtitle}</p>

      {/* Monitoring tabs: active / paused / past vouchers */}
      <div role="tablist" aria-label={t.pass.listTitle} className="mb-3 grid grid-cols-2 gap-2">
        {GROUPS.map((g) => {
          const on = filter.group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setGroup(g.id)}
              className={`flex min-h-16 flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left transition-colors sm:px-4 ${
                on ? 'border-indigo-300 bg-indigo-50 text-indigo-800 shadow-sm' : 'border-gray-100 bg-white text-gray-700 hover:border-indigo-200'
              }`}
            >
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{g.label}</span>
                <span className="text-xl font-semibold">{overview.state.data ? (g.count(overview.state.data)?.toLocaleString('vi-VN') ?? '—') : '—'}</span>
              </span>
              <span className="hidden text-xs text-gray-500 sm:block">{g.hint}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-gray-500">{past ? t.pass.sortPast : t.pass.sortActive}</p>
      {filter.group === 'ACTIVE' && (
        <button
          type="button"
          aria-pressed={filter.expiry === 'EXPIRING_7D'}
          onClick={toggleExpiring}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium ${
            filter.expiry === 'EXPIRING_7D' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-white text-gray-700'
          }`}
        >
          <CalendarClock size={16} aria-hidden />
          {t.pass.expiring7d}
        </button>
      )}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_minmax(220px,auto)]">
        <label className="relative">
          <span className="sr-only">{t.pass.searchPlaceholder}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t.pass.searchPlaceholder}
            className="min-h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <SelectControl value={filter.campaignId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, campaignId: e.target.value || undefined, offset: 0 }))} aria-label={t.pass.cols.promotion}>
          <option value="">{t.pass.filterAllCampaigns}</option>
          {(campaigns.state.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectControl>
      </div>

      {state.status === 'loading' && !state.data ? (
        <PromotionLoading />
      ) : state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
      ) : rows.length === 0 ? (
        <PromotionEmpty title={filter.search || filter.campaignId || filter.expiry ? t.states.noResults : t.pass.groupEmpty} />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_460px]">
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm" aria-busy={state.status === 'loading'}>
          <ul className="divide-y divide-gray-100 xl:hidden">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={PROMOTION_PATHS.pass(p.id)} className="flex items-center gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <p className="font-medium text-gray-900">{p.customer.name}</p>
                      <PassBadge p={p} />
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-gray-700">{p.voucherCode}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {p.campaign.name} · {formatUsedCount(p.usage)} · {endDate(p, past)}
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-gray-300" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-sm xl:table">
            <thead className="bg-gray-50/60 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t.pass.cols.customer}</th>
                <th className="px-4 py-3 font-medium">{t.pass.cols.voucherCode}</th>
                <th className="px-4 py-3 font-medium">{t.pass.cols.status}</th>
                <th className="px-4 py-3 text-right font-medium">{t.pass.cols.usage}</th>
                <th className="hidden px-4 py-3 font-medium 2xl:table-cell">{t.pass.cols.issued}</th>
                <th className="px-4 py-3 font-medium">{past ? t.pass.endedAt : t.pass.cols.expiry}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  aria-selected={selectedId === p.id}
                  className={`cursor-pointer ${selectedId === p.id ? 'bg-indigo-50/70' : 'hover:bg-gray-50/60'}`}
                >
                  <td className="px-4 py-3">
                    <Link href={PROMOTION_PATHS.pass(p.id)} className="font-medium text-gray-900 hover:text-indigo-700">
                      {p.customer.name}
                    </Link>
                    <p className="text-xs text-gray-500">{p.customer.phone ?? p.customer.email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="whitespace-nowrap font-mono text-xs font-semibold text-gray-900">{p.voucherCode}</p>
                    <p className="text-xs text-gray-500">{p.campaign.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <PassBadge p={p} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatUsedCount(p.usage)}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-gray-700 2xl:table-cell">{formatPromoDate(p.issuedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{endDate(p, past)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
              <span>{t.pass.pageOf(offset + 1, Math.min(offset + PAGE_SIZE, total), total)}</span>
              <div className="flex gap-2">
                <button type="button" disabled={offset === 0} onClick={() => setPage(Math.max(0, offset - PAGE_SIZE))} aria-label={t.pass.prevPage} className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 disabled:opacity-40">
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setPage(offset + PAGE_SIZE)} aria-label={t.pass.nextPage} className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 disabled:opacity-40">
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="sticky top-4 hidden rounded-3xl xl:block border border-gray-100 bg-gradient-to-b from-white to-indigo-50/50 p-6 shadow-sm">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.voucher.compareTitle}</p>
          {preview.state.status === 'loading' && !preview.state.data ? (
            <PromotionLoading />
          ) : preview.state.status === 'error' ? (
            <PromotionError message={promotionErrorMessage(preview.state.code)} onRetry={preview.reload} />
          ) : preview.state.data ? (
            <div className="flex flex-col items-center gap-4">
              <VoucherCardSwitchable key={preview.state.data.id} build={(l) => voucherCardFromPass(preview.state.data!, l)} contact={spaContact} />
              <div className="w-full text-sm text-gray-600">
                <p className="font-medium text-gray-900">{preview.state.data.customer.name}</p>
                <p>{[preview.state.data.customer.phone, preview.state.data.customer.email].filter(Boolean).join(' · ')}</p>
              </div>
              <Link
                href={PROMOTION_PATHS.pass(preview.state.data.id)}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                {t.voucher.openDetail}
              </Link>
            </div>
          ) : (
            <PromotionEmpty title={t.voucher.selectToPreview} />
          )}
        </aside>
        </div>
      )}
    </>
  );
};

const PassListPage = () => (
  <PromotionsShell action={'pass.view'} title={t.pass.listTitle}>
    <Suspense fallback={<PromotionLoading />}>
      <PassList />
    </Suspense>
  </PromotionsShell>
);

export default PassListPage;
