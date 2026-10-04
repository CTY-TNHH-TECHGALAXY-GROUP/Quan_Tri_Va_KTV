'use client';

import React, { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import type { PromotionPassWithQr } from '@/lib/types/promotion-client';
import { formatPromoDate, formatUsageType } from '@/lib/promotion-format';
import PromotionStatusBadge from './PromotionStatusBadge';
import { t } from './promotion.i18n';

// 🔧 UI CONFIGURATION
const QR_SIZE = 260;
const QR_MARGIN = 2;

interface QRCodeViewerProps {
  pass: PromotionPassWithQr;
  open: boolean;
  onClose: () => void;
}

/**
 * Large, high-contrast QR for staff to scan. Encodes `pass.qrPayload` exactly
 * as the server returned it — no token is generated here.
 */
const QRCodeViewer = ({ pass, open, onClose }: QRCodeViewerProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const usable = pass.effectiveStatus === 'ACTIVE' && !!pass.qrPayload;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t.qr.title} onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">{t.qr.title}</p>
            <h2 className="text-lg font-semibold text-gray-900">{pass.campaign.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t.actions.close} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 flex justify-center">
          {usable ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-3">
              <QRCodeSVG value={pass.qrPayload} size={QR_SIZE} marginSize={QR_MARGIN} level="M" bgColor="#FFFFFF" fgColor="#000000" />
            </div>
          ) : (
            <p className="rounded-2xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-600">{t.qr.unavailable}</p>
          )}
        </div>

        <p className="mt-4 text-center font-mono text-xl font-semibold tracking-[0.2em] text-gray-900">{pass.voucherCode}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600">
          <PromotionStatusBadge kind="pass" status={pass.effectiveStatus} />
          <span>{formatUsageType(pass.usage)}</span>
          <span aria-hidden>·</span>
          <span>
            {t.card.validUntil} {formatPromoDate(pass.validUntil)}
          </span>
        </div>
        {usable && <p className="mt-4 text-center text-sm text-gray-500">{t.qr.instruction}</p>}
      </div>
    </div>
  );
};

export default QRCodeViewer;
