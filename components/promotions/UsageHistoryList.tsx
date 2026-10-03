'use client';

import React from 'react';
import { Undo2 } from 'lucide-react';
import type { PromotionUsageRecord } from '@/lib/types/promotion-client';
import { formatPromoDateTime, formatVnd, orderCode } from '@/lib/promotion-format';
import PromotionBenefitDisplay from './PromotionBenefitDisplay';
import PromotionStatusBadge from './PromotionStatusBadge';
import { PromotionEmpty } from './PromotionStates';
import { t } from './promotion.i18n';

interface UsageHistoryListProps {
  items: PromotionUsageRecord[];
  /** Compact = pass detail / customer view; hides voucher + campaign columns. */
  compact?: boolean;
  /** Shown on APPLIED rows only; the server refuses once the KM service is dispatched. */
  onCancel?: (usage: PromotionUsageRecord) => void;
}

/** "Voucher của X" when a friend used the owner's voucher. */
const ownerNote = (u: PromotionUsageRecord): string | null =>
  u.passOwner?.name && u.passOwner.id !== u.customer.id ? t.usage.ownerNote(u.passOwner.name) : null;

const CancelButton = ({ u, onCancel }: { u: PromotionUsageRecord; onCancel?: (u: PromotionUsageRecord) => void }) =>
  onCancel && u.status === 'APPLIED' ? (
    <button
      type="button"
      onClick={() => onCancel(u)}
      className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
    >
      <Undo2 size={14} aria-hidden />
      {t.usage.cancel}
    </button>
  ) : null;

const BenefitCell = ({ u }: { u: PromotionUsageRecord }) => (
  <span className="flex flex-col items-end gap-0.5 xl:items-start">
    <PromotionBenefitDisplay benefit={u.benefit} size="sm" />
    {!!u.discountAmount && <span className="text-xs text-gray-500">-{formatVnd(u.discountAmount)}</span>}
  </span>
);

/** Mobile list + desktop table of promotion usages. */
const UsageHistoryList = ({ items, compact = false, onCancel }: UsageHistoryListProps) => {
  if (items.length === 0) return <PromotionEmpty title={t.usage.empty} />;

  return (
    <>
      <ul className={`divide-y divide-gray-100 ${compact ? '' : 'xl:hidden'}`}>
        {items.map((u) => (
          <li key={u.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{formatPromoDateTime(u.appliedAt)}</p>
              <p className="text-xs text-gray-500">
                <span className="font-mono">{orderCode(u.booking)}</span> · {u.customer.name ?? '—'}
              </p>
              {ownerNote(u) && <p className="text-xs text-amber-700">{ownerNote(u)}</p>}
              {!compact && <p className="font-mono text-xs text-gray-500">{u.voucherCode}</p>}
              {u.status === 'CANCELLED' && u.cancelReason && <p className="text-xs text-gray-500">{u.cancelReason}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <BenefitCell u={u} />
              <PromotionStatusBadge kind="usage" status={u.status} />
              <CancelButton u={u} onCancel={onCancel} />
            </div>
          </li>
        ))}
      </ul>

      {!compact && (
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="px-3 py-2 font-medium">{t.usage.cols.date}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.customer}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.promotion}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.voucherCode}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.order}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.benefit}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.staff}</th>
                <th className="px-3 py-2 font-medium">{t.usage.cols.status}</th>
                {onCancel && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/60">
                  <td className="whitespace-nowrap px-3 py-3 text-gray-700">{formatPromoDateTime(u.appliedAt)}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-gray-900">{u.customer.name ?? '—'}</p>
                    {ownerNote(u) && <p className="text-xs text-amber-700">{ownerNote(u)}</p>}
                  </td>
                  <td className="px-3 py-3 text-gray-700">{u.campaignName}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-700">{u.voucherCode}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-700">{orderCode(u.booking)}</td>
                  <td className="px-3 py-3">
                    <BenefitCell u={u} />
                  </td>
                  <td className="px-3 py-3 text-gray-700">{u.staffName ?? '—'}</td>
                  <td className="px-3 py-3">
                    <PromotionStatusBadge kind="usage" status={u.status} />
                  </td>
                  {onCancel && (
                    <td className="px-3 py-3 text-right">
                      <CancelButton u={u} onCancel={onCancel} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default UsageHistoryList;
