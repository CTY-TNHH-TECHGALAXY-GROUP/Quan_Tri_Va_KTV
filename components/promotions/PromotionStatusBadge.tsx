'use client';

import React from 'react';
import { Ban, CheckCircle2, Clock, FileEdit, PauseCircle, XCircle } from 'lucide-react';
import type { PromotionCampaignStatus, PromotionPassEffectiveStatus, PromotionUsageStatus } from '@/lib/types/promotion-client';
import { CAMPAIGN_STATUS_LABEL, PASS_STATUS_LABEL, USAGE_STATUS_LABEL } from './promotion.i18n';

// 🔧 UI CONFIGURATION
const ICON_SIZE = 14;

type Tone = 'green' | 'gray' | 'amber' | 'red' | 'blue';

const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  blue: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const TONE_ICON: Record<Tone, React.ReactNode> = {
  green: <CheckCircle2 size={ICON_SIZE} aria-hidden />,
  gray: <Clock size={ICON_SIZE} aria-hidden />,
  amber: <PauseCircle size={ICON_SIZE} aria-hidden />,
  red: <XCircle size={ICON_SIZE} aria-hidden />,
  blue: <FileEdit size={ICON_SIZE} aria-hidden />,
};

type Props =
  | { kind: 'pass'; status: PromotionPassEffectiveStatus; size?: 'sm' | 'lg' }
  | { kind: 'campaign'; status: PromotionCampaignStatus; size?: 'sm' | 'lg' }
  | { kind: 'usage'; status: PromotionUsageStatus; size?: 'sm' | 'lg' };

const resolve = (p: Props): { tone: Tone; label: string } => {
  switch (p.kind) {
    case 'pass':
      return {
        label: PASS_STATUS_LABEL[p.status],
        tone:
          p.status === 'ACTIVE' ? 'green' : p.status === 'SUSPENDED' || p.status === 'INACTIVE' ? 'amber' : p.status === 'CANCELLED' ? 'red' : p.status === 'NOT_STARTED' ? 'blue' : 'gray',
      };
    case 'campaign':
      return {
        label: CAMPAIGN_STATUS_LABEL[p.status],
        tone: p.status === 'ACTIVE' ? 'green' : p.status === 'INACTIVE' ? 'amber' : p.status === 'DRAFT' ? 'blue' : 'gray',
      };
    case 'usage':
      return {
        label: USAGE_STATUS_LABEL[p.status],
        tone: p.status === 'COMPLETED' ? 'green' : p.status === 'APPLIED' ? 'blue' : 'red',
      };
  }
};

/** Status always carries text + icon, never colour alone. */
const PromotionStatusBadge = (props: Props) => {
  const { tone, label } = resolve(props);
  const sizeClass = props.size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2 py-0.5 text-[11px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold tracking-wide whitespace-nowrap ${sizeClass} ${TONE_CLASS[tone]}`}>
      {props.kind === 'pass' && props.status === 'CANCELLED' ? <Ban size={ICON_SIZE} aria-hidden /> : TONE_ICON[tone]}
      {label}
    </span>
  );
};

export default PromotionStatusBadge;
