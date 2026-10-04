'use client';

import React from 'react';
import type { PromotionEmailLang } from '@/lib/types/promotion-client';
import { VOUCHER_LANG_NAMES, VOUCHER_LANG_ORDER } from './voucher-card.i18n';

interface VoucherLangTabsProps {
  value: PromotionEmailLang;
  onChange: (lang: PromotionEmailLang) => void;
  label: string;
  /** Languages that already have content (small dot). */
  filled?: Partial<Record<PromotionEmailLang, boolean>>;
  /** Mark English as required (asterisk). */
  requiredEn?: boolean;
  className?: string;
}

/** EN | VI | 中文 | 日本語 | 한국어 — segmented control, English first. */
const VoucherLangTabs = ({ value, onChange, label, filled, requiredEn = false, className = '' }: VoucherLangTabsProps) => (
  <div role="tablist" aria-label={label} className={`flex flex-wrap gap-1.5 ${className}`}>
    {VOUCHER_LANG_ORDER.map((l) => {
      const on = l === value;
      return (
        <button
          key={l}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => onChange(l)}
          className={`relative inline-flex min-h-11 min-w-12 items-center justify-center gap-1 rounded-xl border px-3 text-sm font-semibold ${
            on ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-200'
          }`}
        >
          {VOUCHER_LANG_NAMES[l]}
          {requiredEn && l === 'en' && <span aria-hidden className={on ? 'text-indigo-100' : 'text-rose-500'}>*</span>}
          {filled?.[l] && l !== 'en' && (
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-white' : 'bg-emerald-500'}`} />
          )}
        </button>
      );
    })}
  </div>
);

export default VoucherLangTabs;
