'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { useSpaContact } from '@/components/promotions/useSpaContact';
import VoucherCard3D from '@/components/promotions/VoucherCard3D';
import VoucherLangTabs from '@/components/promotions/VoucherLangTabs';
import { voucherCardFromPass } from '@/components/promotions/VoucherCard3D.logic';
import { VOUCHER_CARD_LABELS } from '@/components/promotions/voucher-card.i18n';
import { t } from '@/components/promotions/promotion.i18n';
import { formatPromoDate, promotionErrorMessage } from '@/lib/promotion-format';
import { formatPromotionConditions, pickPromotionText, PROMOTION_VOUCHER_PAGE_I18N } from '@/lib/promotion-voucher.i18n';
import { PROMOTION_API_MODE, promotionApi } from '@/lib/services/promotionApi';
import type { PromotionEmailLang } from '@/lib/types/promotion-client';

// 🔧 UI CONFIGURATION
const PAGE_SIZE = 'A5 portrait';
const PAGE_MARGIN = '10mm';
const QR_SIZE_PX = 150;
const PRINT_ROOT_ID = 'voucher-print-root';
/**
 * Paper / PDF gets ONLY a copy of the sheet mounted directly on <body>; the admin layout is
 * display:none (no blank 2nd page, small PDF). The on-screen preview is hidden when printing.
 */
const PRINT_CSS = `
@page { size: ${PAGE_SIZE}; margin: ${PAGE_MARGIN}; }
#${PRINT_ROOT_ID} { display: none; }
@media print {
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block; }
  #${PRINT_ROOT_ID} article { border: 0; box-shadow: none; max-width: none; padding: 0; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

/** Mounts the print copy on <body> (outside the admin layout). */
const PrintRoot = ({ children }: { children: React.ReactNode }) => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.id = PRINT_ROOT_ID;
    document.body.appendChild(el);
    setHost(el);
    return () => el.remove();
  }, []);
  return host ? createPortal(children, host) : null;
};

/**
 * Printable e-voucher (A5) — the browser print dialog saves it as PDF.
 * The card is the same PNG the customer gets by email (server-painted, sharp at 2x).
 */
const VoucherPrint = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const contact = useSpaContact();
  const [lang, setLang] = useState<PromotionEmailLang>('en');
  const [cardFailed, setCardFailed] = useState(PROMOTION_API_MODE === 'mock');
  const [cardReady, setCardReady] = useState(false);
  const autoPrinted = useRef(false);
  const pass = usePromotionQuery(() => promotionApi.getPass(id), [id]);
  const p = pass.state.status === 'success' ? pass.state.data : null;

  // ?auto=1 (from the "In / Tải PDF" button): open the print dialog once the card is painted.
  useEffect(() => {
    if (params.get('auto') !== '1' || autoPrinted.current || !p || (!cardReady && !cardFailed)) return;
    autoPrinted.current = true;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [params, p, cardReady, cardFailed]);

  useEffect(() => {
    setCardReady(false);
    setCardFailed(PROMOTION_API_MODE === 'mock');
  }, [lang]);

  if (pass.state.status === 'loading') return <PromotionLoading />;
  if (pass.state.status === 'error' || !p) return <PromotionError message={promotionErrorMessage(pass.state.status === 'error' ? pass.state.code : undefined)} onRetry={pass.reload} />;

  const L = VOUCHER_CARD_LABELS[lang];
  const page = PROMOTION_VOUCHER_PAGE_I18N[lang];
  const conditions = formatPromotionConditions(p.conditionsSummary, lang);
  const campaignName = pickPromotionText(p.campaign.name, p.campaign.nameI18n, lang);
  const imgBase = `/api/admin/promotions/passes/${encodeURIComponent(p.id)}/card-image`;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button type="button" onClick={() => router.back()} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100">
          <ArrowLeft size={18} aria-hidden />
          {t.print.back}
        </button>
        <VoucherLangTabs value={lang} onChange={setLang} label={t.voucher.viewIn} />
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">
          <Printer size={18} aria-hidden />
          {t.print.print}
        </button>
      </div>
      <p className="text-xs text-gray-500 print:hidden">{t.print.hint}</p>

      {/* A5 sheet: preview on screen + the same sheet mounted on <body> for the printer */}
      {[false, true].map((forPrint) => {
        const sheet = (
      <article key={String(forPrint)} className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-5 rounded-2xl border border-gray-200 bg-white p-6 text-center text-[#2B1A0E] shadow-sm" lang={lang}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${imgBase}?part=logo`} alt={contact?.brandName ?? 'Oria Spa'} className="h-14 w-auto" onError={(e) => (e.currentTarget.style.display = 'none')} />

        {cardFailed ? (
          <div className="pointer-events-none w-full">
            <VoucherCard3D data={voucherCardFromPass(p, lang)} labels={L} contact={contact} showHint={false} />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={lang}
            src={`${imgBase}?lang=${lang}`}
            alt={`${campaignName} — ${p.voucherCode}`}
            className="w-full rounded-2xl"
            onLoad={() => !forPrint && setCardReady(true)}
            onError={() => !forPrint && setCardFailed(true)}
          />
        )}

        <div className="flex w-full items-center gap-5 rounded-2xl border border-[#F0D9B5] bg-[#FFF8EC] p-4 text-left">
          {p.qrPayload ? (
            <QRCodeSVG value={p.qrPayload} size={QR_SIZE_PX} marginSize={1} level="M" fgColor="#2B1A0E" bgColor="#FFFFFF" className="shrink-0" />
          ) : null}
          <dl className="min-w-0 space-y-1.5 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-[#6B4A2A]">{L.voucherCode}</dt>
              <dd className="font-mono text-lg font-bold tracking-wider">{p.voucherCode}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[#6B4A2A]">{page.validUntil}</dt>
              <dd className="font-semibold">{formatPromoDate(p.validUntil)}</dd>
            </div>
            {p.customer.name && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-[#6B4A2A]">{L.forCustomer}</dt>
                <dd className="font-semibold">{p.customer.name}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-[#6B4A2A]">{page.applicableMenus}</dt>
              <dd className="font-semibold">{conditions.length ? conditions.join('; ') : page.allMenus}</dd>
            </div>
          </dl>
        </div>

        <p className="text-sm font-medium">{page.contactToApply(contact?.brandName ?? 'Oria Spa')}</p>
        {contact && (
          <div className="space-y-0.5 text-xs text-[#6B4A2A]">
            {contact.hotline && <p>{page.hotline}: {contact.hotline}</p>}
            {contact.address && <p>{page.address}: {contact.address}</p>}
            {contact.websiteUrl && <p>{contact.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>}
          </div>
        )}
      </article>
        );
        return forPrint ? <PrintRoot key="print">{sheet}</PrintRoot> : <div key="screen" className="print:hidden">{sheet}</div>;
      })}
    </div>
  );
};

const VoucherPrintPage = () => (
  <PromotionsShell action={'pass.view'} title={t.print.title} bare>
    <Suspense fallback={<PromotionLoading />}>
      <VoucherPrint />
    </Suspense>
  </PromotionsShell>
);

export default VoucherPrintPage;
