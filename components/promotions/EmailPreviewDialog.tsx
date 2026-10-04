'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { PromotionEmailLang, PromotionEmailPreview } from '@/lib/types/promotion-client';
import { promotionApi } from '@/lib/services/promotionApi';
import { promotionErrorMessage } from '@/lib/promotion-format';
import VoucherLangTabs from './VoucherLangTabs';
import { t } from './promotion.i18n';

// 🔧 UI CONFIGURATION
const FRAME_HEIGHT = 'min(70vh, 900px)';

interface EmailPreviewDialogProps {
  passId: string;
  onClose: () => void;
}

/** Shows the exact e-voucher email (sender, reply-to, subject, body) in each language. Sends nothing. */
const EmailPreviewDialog = ({ passId, onClose }: EmailPreviewDialogProps) => {
  const [lang, setLang] = useState<PromotionEmailLang | null>(null);
  const [state, setState] = useState<{ loading: boolean; data: PromotionEmailPreview | null; error: string | null }>({ loading: true, data: null, error: null });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    promotionApi.getEmailPreview(passId, lang ?? undefined).then((res) => {
      if (!alive) return;
      if (res.success) {
        setState({ loading: false, data: res.data, error: null });
        if (!lang) setLang(res.data.lang);
      } else setState({ loading: false, data: null, error: promotionErrorMessage(res.error.code) });
    });
    return () => {
      alive = false;
    };
  }, [passId, lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = state.data;
  return (
    <div role="dialog" aria-modal="true" aria-label={t.pass.previewEmailTitle} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{t.pass.previewEmailTitle}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t.pass.previewEmailHint}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.pass.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4 sm:p-5">
          <VoucherLangTabs value={lang ?? 'en'} onChange={setLang} label={t.pass.emailLang} />
          {d && (
            <dl className="grid gap-x-4 gap-y-1 rounded-2xl bg-gray-50 p-3 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-gray-500">{t.pass.emailFrom}</dt>
              <dd className="break-all font-medium text-gray-900">{d.from}</dd>
              <dt className="text-gray-500">{t.pass.emailReplyTo}</dt>
              <dd className="break-all font-medium text-gray-900">{d.replyTo}</dd>
              <dt className="text-gray-500">{t.pass.emailTo}</dt>
              <dd className="break-all font-medium text-gray-900">{d.to ?? '—'}</dd>
              <dt className="text-gray-500">{t.pass.emailSubject}</dt>
              <dd className="font-medium text-gray-900">{d.subject}</dd>
            </dl>
          )}
          <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-[#f6f3ee]" style={{ height: FRAME_HEIGHT }}>
            {state.loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                <Loader2 size={24} className="animate-spin text-gray-400" aria-hidden />
              </div>
            )}
            {state.error && <p className="p-6 text-sm text-rose-600">{state.error}</p>}
            {d && <iframe title={d.subject} srcDoc={d.html} sandbox="" className="h-full w-full border-0" />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailPreviewDialog;
