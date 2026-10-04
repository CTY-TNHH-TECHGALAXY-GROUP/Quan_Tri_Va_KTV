'use client';

import React from 'react';
import type { PromotionEmailLang } from '@/lib/types/promotion-client';
import VoucherCard3D from './VoucherCard3D';
import type { VoucherCardData } from './VoucherCard3D.logic';
import { VOUCHER_CARD_LABELS } from './voucher-card.i18n';

interface VoucherCardLocalizedProps {
  data: VoucherCardData;
  lang: PromotionEmailLang;
  brandName: string;
  contact: React.ComponentProps<typeof VoucherCard3D>['contact'];
}

/**
 * Server pages can only pass plain data to client components; the card labels hold
 * formatter functions, so they are picked here from `lang` on the client side.
 */
const VoucherCardLocalized = ({ data, lang, brandName, contact }: VoucherCardLocalizedProps) => (
  <VoucherCard3D data={data} labels={VOUCHER_CARD_LABELS[lang]} brandName={brandName} contact={contact} />
);

export default VoucherCardLocalized;
