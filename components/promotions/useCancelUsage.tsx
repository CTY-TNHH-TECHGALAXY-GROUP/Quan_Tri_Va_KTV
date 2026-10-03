'use client';

import React, { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';
import type { PromotionUsageRecord } from '@/lib/types/promotion-client';
import { t } from './promotion.i18n';

/** Confirm + call `cancelUsage`. The server decides whether it is still cancellable. */
export const useCancelUsage = (onDone: () => void) => {
  const { addToast } = useToast();
  const [pending, setPending] = useState<PromotionUsageRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    const res = await promotionApi.cancelUsage(pending.id);
    setBusy(false);
    setPending(null);
    if (!res.success) {
      addToast(promotionErrorMessage(res.error.code), 'error');
      return;
    }
    addToast(t.usage.cancelled, 'success');
    onDone();
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={t.usage.cancel}
      message={t.usage.confirmCancel}
      confirmText={t.usage.cancel}
      variant="danger"
      isLoading={busy}
      onConfirm={confirm}
      onCancel={() => setPending(null)}
    />
  );

  return { request: setPending, dialog };
};
