'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import CampaignForm from '@/components/promotions/CampaignForm';
import { EMPTY_CAMPAIGN_FORM, toCampaignPayload } from '@/components/promotions/CampaignForm.logic';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { t } from '@/components/promotions/promotion.i18n';
import { useToast } from '@/components/ui/Toast';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';
import type { CampaignFormInput } from '@/lib/types/promotion-client';

const NewCampaignPage = () => {
  const router = useRouter();
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (input: CampaignFormInput) => {
    setSubmitting(true);
    const res = await promotionApi.createCampaign(toCampaignPayload(input));
    setSubmitting(false);
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    addToast(t.campaign.created, 'success');
    router.push(PROMOTION_PATHS.campaign(res.data.id));
  };

  return (
    <PromotionsShell title={t.campaign.createTitle}>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{t.campaign.createTitle}</h1>
      <div>
        <CampaignForm initial={EMPTY_CAMPAIGN_FORM} submitting={submitting} submitLabel={t.actions.createPromotion} onSubmit={handleSubmit} />
      </div>
    </PromotionsShell>
  );
};

export default NewCampaignPage;
