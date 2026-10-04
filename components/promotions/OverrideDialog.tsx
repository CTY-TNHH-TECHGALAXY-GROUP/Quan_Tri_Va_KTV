'use client';

import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { PromotionErrorCode } from '@/lib/types/promotion-client';
import { promotionErrorMessage } from '@/lib/promotion-format';
import { t } from './promotion.i18n';

interface OverrideDialogProps {
  open: boolean;
  reasons: string[];
  note: string;
  maxLength: number;
  error: PromotionErrorCode | null;
  submitting: boolean;
  onNoteChange: (note: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * "Apply as an exception" popup (contract v8 §4.1): shows the server's unmet
 * conditions and requires a reason, which is stored with the staff name.
 */
const OverrideDialog = ({ open, reasons, note, maxLength, error, submitting, onNoteChange, onConfirm, onClose }: OverrideDialogProps) => {
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    noteRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !submitting && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="override-title">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="override-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <AlertTriangle size={20} className="text-amber-500" aria-hidden />
            {t.scan.overrideTitle}
          </h2>
          <button type="button" onClick={onClose} disabled={submitting} aria-label={t.actions.close} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600">{t.scan.overrideIntro}</p>
        <ul className="mt-2 space-y-1 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>

        <label className="mt-4 block">
          <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-gray-700">
            {t.scan.overrideNoteLabel}
            <span className="text-xs font-normal text-gray-400">{t.scan.overrideCount(note.trim().length, maxLength)}</span>
          </span>
          <textarea
            ref={noteRef}
            value={note}
            maxLength={maxLength}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t.scan.overrideNotePlaceholder}
            aria-invalid={!!error}
            className={`min-h-24 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              error ? 'border-rose-300 focus:ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-indigo-100'
            }`}
          />
          <span className="mt-1 block text-xs text-gray-500">{t.scan.overrideNoteHint}</span>
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-rose-600">
            {promotionErrorMessage(error)}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2 pb-[env(safe-area-inset-bottom)]">
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-12 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-700">
            {t.actions.cancelAction}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {t.scan.overrideConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OverrideDialog;
