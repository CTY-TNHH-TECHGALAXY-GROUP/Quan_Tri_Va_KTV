'use client';

import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { t } from './promotion.i18n';

export const PromotionLoading = ({ label = t.states.loading }: { label?: string }) => (
  <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
    <Loader2 className="animate-spin text-indigo-500" size={28} aria-hidden />
    <span className="text-sm">{label}</span>
  </div>
);

export const PromotionEmpty = ({ title = t.states.empty, hint, action }: { title?: string; hint?: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
    <Inbox className="text-gray-300" size={36} aria-hidden />
    <p className="font-medium text-gray-700">{title}</p>
    {hint && <p className="max-w-sm text-sm text-gray-500">{hint}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export const PromotionError = ({ message = t.states.loadError, onRetry }: { message?: string; onRetry?: () => void }) => (
  <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/60 px-6 py-10 text-center">
    <AlertTriangle className="text-rose-500" size={30} aria-hidden />
    <p className="font-medium text-rose-800">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50"
      >
        <RefreshCw size={16} aria-hidden />
        {t.actions.retry}
      </button>
    )}
  </div>
);
