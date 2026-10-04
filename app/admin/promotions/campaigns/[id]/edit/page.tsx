'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import CampaignForm from '@/components/promotions/CampaignForm';
import { campaignToForm, toCampaignPayload, toLockedCampaignPatch } from '@/components/promotions/CampaignForm.logic';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { PROMOTION_PATHS } from '@/components/promotions/promotion.paths';
import { t } from '@/components/promotions/promotion.i18n';
import { useToast } from '@/components/ui/Toast';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';
import type { CampaignFormInput } from '@/lib/types/promotion-client';

const EditCampaignPage = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const { state, reload } = usePromotionQuery(() => promotionApi.getCampaign(id), [id]);

  const handleSubmit = async (input: CampaignFormInput) => {
    setSubmitting(true);
    // Active campaigns only take the editable keys; sending rule keys could be read as a change.
    const locked = state.status === 'success' && state.data.status !== 'DRAFT';
    const res = await promotionApi.updateCampaign(id, locked ? toLockedCampaignPatch(input) : toCampaignPayload(input));
    setSubmitting(false);
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    addToast(t.campaign.updated, 'success');
    router.push(PROMOTION_PATHS.campaign(id));
  };

  return (
    <PromotionsShell action={'campaign.manage'} title={t.campaign.editTitle}>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{t.campaign.editTitle}</h1>
      {state.status === 'loading' ? (
        <PromotionLoading />
      ) : state.status === 'error' ? (
        <PromotionError message={promotionErrorMessage(state.code)} onRetry={reload} />
      ) : (
        <div>
          <CampaignForm
            key={state.data.id}
            initial={campaignToForm(state.data)}
            lockIdentity
            // Engine rule: rule keys are frozen once a campaign has been activated.
            lockRules={state.data.status !== 'DRAFT'}
            submitting={submitting}
            submitLabel={t.actions.save}
            onSubmit={handleSubmit}
          />
        </div>
      )}
    </PromotionsShell>
  );
};

export default EditCampaignPage;
