'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, DoorOpen, Lock } from 'lucide-react';
import type { PromotionOrderCandidate } from '@/lib/types/promotion-client';
import { formatVnd, orderCode, orderEligibility, promotionErrorMessage } from '@/lib/promotion-format';
import { ERROR_MESSAGE, ORDER_STATUS_LABEL, t } from './promotion.i18n';

interface OrderSelectCardProps {
  order: PromotionOrderCandidate;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ELIGIBILITY_BADGE = {
  ELIGIBLE: { label: t.scan.eligible, className: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  NOT_ELIGIBLE: { label: t.scan.notEligible, className: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle },
  BLOCKED: { label: t.scan.blocked, className: 'border-gray-200 bg-gray-100 text-gray-600', Icon: Lock },
} as const;

/**
 * Radio-style order card. Eligibility, reasons and whether it can be selected
 * all come from the server: BLOCKED is disabled; NOT_ELIGIBLE stays selectable
 * so the counter can apply it as an exception (with a mandatory reason).
 */
const OrderSelectCard = ({ order, selected, onSelect }: OrderSelectCardProps) => {
  const eligibility = orderEligibility(order);
  const disabled = eligibility === 'BLOCKED';
  const badge = ELIGIBILITY_BADGE[eligibility];
  const reasons = order.unmetReasons ?? [];
  const mainService = order.items.filter((i) => !i.isPromotion).map((i) => i.serviceName).join(', ');

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onSelect(order.id)}
      className={`w-full rounded-2xl border p-4 text-left transition-all min-h-11 ${
        disabled
          ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-70'
          : selected
            ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-200'
            : 'border-gray-200 bg-white hover:border-indigo-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-indigo-600" aria-hidden>
          {disabled ? <Lock size={20} className="text-gray-400" /> : selected ? <CheckCircle2 size={20} /> : <Circle size={20} className="text-gray-300" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sm font-semibold text-gray-900">{orderCode(order)}</span>
            <span className="flex flex-wrap items-center gap-1">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                <badge.Icon size={12} aria-hidden />
                {badge.label}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{ORDER_STATUS_LABEL[order.status as keyof typeof ORDER_STATUS_LABEL] ?? order.status}</span>
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-gray-800">{mainService || '—'}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{order.customerName ?? '—'}</span>
            {order.isPassOwnerOrder && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">{t.order.ownerTag}</span>}
            {order.bookingTime && (
              <span className="inline-flex items-center gap-1">
                <Clock size={12} aria-hidden />
                {order.bookingTime}
              </span>
            )}
            {order.roomLabel && (
              <span className="inline-flex items-center gap-1">
                <DoorOpen size={12} aria-hidden />
                {order.roomLabel}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            {t.order.minutes(order.totalDurationMinutes)} · {formatVnd(order.totalAmount)}
          </p>
          {eligibility === 'NOT_ELIGIBLE' && reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {disabled && order.blockedReasonCode && (
            <p className="mt-2 text-xs font-medium text-rose-600">{order.blockedReasonCode && order.blockedReasonCode in ERROR_MESSAGE ? promotionErrorMessage(order.blockedReasonCode) : (order.blockedReason ?? promotionErrorMessage(order.blockedReasonCode))}</p>
          )}
        </div>
      </div>
    </button>
  );
};

export default OrderSelectCard;
