'use client';

import React, { useState } from 'react';
import type { PromotionEmailLang } from '@/lib/types/promotion-client';
import VoucherCard3D from './VoucherCard3D';
import type { VoucherCardData } from './VoucherCard3D.logic';
import VoucherLangTabs from './VoucherLangTabs';
import { VOUCHER_CARD_LABELS } from './voucher-card.i18n';
import { t } from './promotion.i18n';

interface VoucherCardSwitchableProps {
  /** Card data in a language (campaign name follows it). */
  build: (lang: PromotionEmailLang) => VoucherCardData;
  contact: React.ComponentProps<typeof VoucherCard3D>['contact'];
  className?: string;
}

/**
 * Admin card with a language switch: starts in English (the customer default)
 * so the counter can match exactly what the customer has on screen.
 */
const VoucherCardSwitchable = ({ build, contact, className = '' }: VoucherCardSwitchableProps) => {
  const [lang, setLang] = useState<PromotionEmailLang>('en');
  return (
    <div className={`flex w-full flex-col items-center gap-3 ${className}`}>
      <VoucherLangTabs value={lang} onChange={setLang} label={t.voucher.viewIn} className="justify-center" />
      <VoucherCard3D data={build(lang)} labels={VOUCHER_CARD_LABELS[lang]} contact={contact} />
    </div>
  );
};

export default VoucherCardSwitchable;
