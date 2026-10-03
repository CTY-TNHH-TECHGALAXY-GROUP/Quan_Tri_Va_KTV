'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, ScanLine, ShieldAlert } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import type { PromotionAction } from '@/lib/constants/promotion';
import { usePromotionAccess } from './usePromotionAccess';
import { PROMOTION_API_MODE } from '@/lib/services/promotionApi';
import { PROMOTION_PATHS } from './promotion.paths';
import { PromotionLoading } from './PromotionStates';
import { t } from './promotion.i18n';

const TABS = [
  { key: 'overview', href: PROMOTION_PATHS.overview, label: t.nav.overview, exact: true },
  { key: 'campaigns', href: PROMOTION_PATHS.campaigns, label: t.nav.campaigns },
  { key: 'passes', href: PROMOTION_PATHS.passes, label: t.nav.passes },
  { key: 'usages', href: PROMOTION_PATHS.usages, label: t.nav.usages },
] as const;

interface PromotionsShellProps {
  title?: string;
  children: React.ReactNode;
  /** Scanner page hides tabs + primary actions to keep the mobile flow short. */
  bare?: boolean;
  /** Engine action(s) this page needs — any one of them opens it (Agent A v9 §0.1). */
  action: PromotionAction | PromotionAction[];
}

const PromotionsShell = ({ title = t.module, children, bare = false, action }: PromotionsShellProps) => {
  const pathname = usePathname();
  const { role } = useAuth();
  const access = usePromotionAccess();
  const allowed = (Array.isArray(action) ? action : [action]).some((a) => access.can(a));

  // Auth restores the session from storage after the first render — don't flash "no permission".
  if (!role) {
    return (
      <AppLayout title={title}>
        <PromotionLoading />
      </AppLayout>
    );
  }

  if (!allowed) {
    return (
      <AppLayout title={title}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <ShieldAlert size={48} className="mb-4 text-red-500" />
          <h2 className="text-xl font-bold text-gray-900">{t.noPermission}</h2>
        </div>
      </AppLayout>
    );
  }

  return (
    // Scanner hides the floating AI button: it would cover the sticky Apply button on phones.
    <AppLayout title={title} hideAI={bare}>
      <div className="mx-auto w-full max-w-6xl py-2 sm:py-4">
        {PROMOTION_API_MODE === 'mock' && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            {t.mockBanner}
          </p>
        )}
        {!bare && (
          <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label={t.module}>
              {TABS.filter((tab) => access.tabs[tab.key]).map((tab) => {
                const active = 'exact' in tab ? pathname === tab.href : pathname === tab.href || pathname.startsWith(tab.href + '/');
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:flex sm:justify-end">
              {access.scan && (
              <Link
                href={PROMOTION_PATHS.scan}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
              >
                <ScanLine size={18} aria-hidden />
                {t.actions.scanVoucher}
              </Link>
              )}
              {access.createCampaign && (
              <Link
                href={PROMOTION_PATHS.newCampaign}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                <Plus size={18} aria-hidden />
                {t.actions.createPromotion}
              </Link>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </AppLayout>
  );
};

export default PromotionsShell;
