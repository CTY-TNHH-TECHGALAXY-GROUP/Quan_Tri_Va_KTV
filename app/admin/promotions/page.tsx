'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, BadgePercent, History, ScanLine, Ticket } from 'lucide-react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import { PromotionError } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { t } from '@/components/promotions/promotion.i18n';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';

const KPIS = [
  { key: 'activeCampaigns', label: t.overview.activeCampaigns, href: PROMOTION_PATHS.campaigns },
  { key: 'passesIssued', label: t.overview.passesIssued, href: PROMOTION_PATHS.passes },
  { key: 'activePasses', label: t.overview.activePasses, href: `${PROMOTION_PATHS.passes}?tab=active` },
  { key: 'pastPasses', label: t.overview.pastPasses, href: `${PROMOTION_PATHS.passes}?tab=past` },
  { key: 'usesThisMonth', label: t.overview.usesThisMonth, href: PROMOTION_PATHS.usages },
] as const;

const SHORTCUTS = [
  { href: PROMOTION_PATHS.scan, label: t.nav.scan, icon: ScanLine, primary: true },
  { href: PROMOTION_PATHS.campaigns, label: t.nav.campaigns, icon: BadgePercent },
  { href: PROMOTION_PATHS.passes, label: t.nav.passes, icon: Ticket },
  { href: PROMOTION_PATHS.usages, label: t.nav.usages, icon: History },
];

const PromotionsOverviewPage = () => {
  const { state, reload } = usePromotionQuery(() => promotionApi.getOverview(), []);

  return (
    <PromotionsShell>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">{t.overview.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.overview.subtitle}</p>
      </header>

      {state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
      ) : (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy={state.status === 'loading'}>
          {KPIS.map((k) => (
            <Link key={k.key} href={k.href} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200">
              <p className="text-xs font-medium text-gray-500">{k.label}</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {state.data ? (state.data[k.key]?.toLocaleString('vi-VN') ?? '—') : <span className="inline-block h-7 w-12 animate-pulse rounded bg-gray-100" />}
              </p>
            </Link>
          ))}
        </section>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">{t.overview.shortcuts}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {SHORTCUTS.map(({ href, label, icon: Icon, primary }) => (
          <Link
            key={href}
            href={href}
            className={`flex min-h-16 items-center justify-between rounded-2xl border px-5 py-4 shadow-sm transition-colors ${
              primary ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700' : 'border-gray-100 bg-white text-gray-800 hover:border-indigo-200'
            }`}
          >
            <span className="flex items-center gap-3 font-semibold">
              <Icon size={22} aria-hidden />
              {label}
            </span>
            <ArrowRight size={18} aria-hidden />
          </Link>
        ))}
      </div>
    </PromotionsShell>
  );
};

export default PromotionsOverviewPage;
