'use client';

import React from 'react';
import { Gift, Percent, Timer } from 'lucide-react';
import type { PromotionBenefit } from '@/lib/types/promotion-client';
import { formatBenefit } from '@/lib/promotion-format';

type Size = 'sm' | 'md' | 'xl';

const SIZE_CLASS: Record<Size, string> = {
  sm: 'text-sm gap-1',
  md: 'text-base gap-1.5',
  xl: 'text-3xl gap-2 tracking-tight',
};

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 16, xl: 28 };

const PromotionBenefitDisplay = ({ benefit, size = 'md' }: { benefit: PromotionBenefit; size?: Size }) => {
  const Icon = benefit.type === 'FREE_MINUTES' ? Timer : benefit.type === 'PERCENT_DISCOUNT' || benefit.type === 'FIXED_DISCOUNT' ? Percent : Gift;
  return (
    <span className={`inline-flex items-center whitespace-nowrap font-bold text-indigo-700 ${SIZE_CLASS[size]}`}>
      <Icon size={ICON_SIZE[size]} aria-hidden />
      {formatBenefit(benefit)}
    </span>
  );
};

export default PromotionBenefitDisplay;
