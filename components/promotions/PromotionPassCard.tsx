'use client';

import React from 'react';
import { CalendarClock, History, Ticket, UserRound } from 'lucide-react';
import type { PromotionPass } from '@/lib/types/promotion-client';
import { formatPromoDate, formatPromoDateTime, formatUsageType, formatUsedCount } from '@/lib/promotion-format';
import PromotionBenefitDisplay from './PromotionBenefitDisplay';
import PromotionStatusBadge from './PromotionStatusBadge';
import { t } from './promotion.i18n';

interface PromotionPassCardProps {
  pass: PromotionPass;
  /** Hide the customer line on customer-facing screens. */
  showCustomer?: boolean;
  actions?: React.ReactNode;
}

/** The voucher card used by the scanner result, pass detail and customer history. */
const PromotionPassCard = ({ pass, showCustomer = true, actions }: PromotionPassCardProps) => {
  const isActive = pass.effectiveStatus === 'ACTIVE';
  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${isActive ? 'border-indigo-100' : 'border-gray-200 opacity-90'}`}
      aria-label={pass.campaign.name}
    >
      <div className={`px-5 pb-4 pt-5 ${isActive ? 'bg-gradient-to-br from-indigo-50 via-white to-amber-50/40' : 'bg-gray-50'}`}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900">{pass.campaign.name}</h3>
          <PromotionStatusBadge kind="pass" status={pass.effectiveStatus} />
        </div>
        <div className="mt-3">
          <PromotionBenefitDisplay benefit={pass.benefit} size="xl" />
          <p className="mt-1 text-xs uppercase tracking-wider text-gray-500">{t.card.complimentary}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-dashed border-gray-200 px-5 py-4 text-sm">
        {showCustomer && (
          <div className="col-span-2 flex items-center gap-2">
            <UserRound size={16} className="text-gray-400" aria-hidden />
            <dt className="sr-only">{t.pass.fields.customer}</dt>
            <dd className="font-medium text-gray-900">{pass.customer.name ?? '—'}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-gray-500">{t.pass.fields.usageType}</dt>
          <dd className="font-medium text-gray-800">{formatUsageType(pass.usage)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">{t.card.used}</dt>
          <dd className="font-medium text-gray-800">{formatUsedCount(pass.usage)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-gray-500">
            <CalendarClock size={12} aria-hidden />
            {t.card.validUntil}
          </dt>
          <dd className="font-medium text-gray-800">{formatPromoDate(pass.validUntil)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-gray-500">
            <History size={12} aria-hidden />
            {t.card.lastUsed}
          </dt>
          <dd className="font-medium text-gray-800">{pass.lastUsedAt ? formatPromoDateTime(pass.lastUsedAt) : t.pass.never}</dd>
        </div>
        <div className="col-span-2">
          <dt className="flex items-center gap-1 text-xs text-gray-500">
            <Ticket size={12} aria-hidden />
            {t.card.voucherCode}
          </dt>
          <dd className="font-mono text-base font-semibold tracking-widest text-gray-900">{pass.voucherCode}</dd>
        </div>
        {pass.statusReason && !isActive && (
          <div className="col-span-2">
            <dt className="text-xs text-gray-500">{t.pass.fields.statusReason}</dt>
            <dd className="text-gray-700">{pass.statusReason}</dd>
          </div>
        )}
      </dl>

      {actions && <div className="flex flex-wrap gap-2 border-t border-gray-100 px-5 py-4">{actions}</div>}
    </article>
  );
};

export default PromotionPassCard;
