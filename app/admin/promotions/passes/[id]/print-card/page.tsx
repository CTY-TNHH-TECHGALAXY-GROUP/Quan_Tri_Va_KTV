'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Globe, MapPin, Phone, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import PromotionsShell from '@/components/promotions/PromotionsShell';
import { PromotionError, PromotionLoading } from '@/components/promotions/PromotionStates';
import { usePromotionQuery } from '@/components/promotions/usePromotionQuery';
import { useSpaContact } from '@/components/promotions/useSpaContact';
import VoucherLangTabs from '@/components/promotions/VoucherLangTabs';
import { voucherCardFromPass } from '@/components/promotions/VoucherCard3D.logic';
import { VOUCHER_CARD_LABELS } from '@/components/promotions/voucher-card.i18n';
import { t } from '@/components/promotions/promotion.i18n';
import { formatPromoDate, promotionErrorMessage } from '@/lib/promotion-format';
import { formatPromotionConditions, pickPromotionText, PROMOTION_VOUCHER_PAGE_I18N } from '@/lib/promotion-voucher.i18n';
import { promotionApi } from '@/lib/services/promotionApi';
import type { PromotionEmailLang } from '@/lib/types/promotion-client';
import { BACK_PAPER, FRONT_BOARD, ORIA } from '@/components/promotions/voucher.theme';
import { voucherBrush } from '@/components/promotions/voucher.fonts';
import { Cinnamon, Mortar, SpaStill, Sprig } from '@/components/promotions/VoucherBotanicals';

// 🔧 NAMECARD CONFIGURATION (5.5 x 9 cm = 90 x 55 mm)
const CARD_W_MM = '90mm';
const CARD_H_MM = '55mm';
const STUB_PERCENT = 27; // 27% width for ticket stub (cuống vé)
const STUB_QR_SIZE = 48; // QR on stub
const BACK_QR_SIZE = 72; // QR on back
const PRINT_ROOT_ID = 'voucher-card-print-root';

const PRINT_CARD_CSS = `
@page {
  size: ${CARD_W_MM} ${CARD_H_MM} landscape;
  margin: 0;
}
#${PRINT_ROOT_ID} { display: none; }
@media print {
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .card-sheet {
    width: ${CARD_W_MM} !important;
    height: ${CARD_H_MM} !important;
    max-width: ${CARD_W_MM} !important;
    max-height: ${CARD_H_MM} !important;
    box-sizing: border-box !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: hidden !important;
    position: relative !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .card-sheet-front {
    page-break-after: always !important;
    break-after: page !important;
  }
  .card-sheet-back {
    page-break-after: auto !important;
    break-after: auto !important;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

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

const VoucherCardPrint = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const contact = useSpaContact();
  const [lang, setLang] = useState<PromotionEmailLang>('vi');
  const autoPrinted = useRef(false);
  const pass = usePromotionQuery(() => promotionApi.getPass(id), [id]);
  const p = pass.state.status === 'success' ? pass.state.data : null;

  // ?auto=1: open the browser print dialog once data is loaded
  useEffect(() => {
    if (params.get('auto') !== '1' || autoPrinted.current || !p) return;
    autoPrinted.current = true;
    const timer = setTimeout(() => window.print(), 350);
    return () => clearTimeout(timer);
  }, [params, p]);

  if (pass.state.status === 'loading') return <PromotionLoading />;
  if (pass.state.status === 'error' || !p) return <PromotionError message={promotionErrorMessage(pass.state.status === 'error' ? pass.state.code : undefined)} onRetry={pass.reload} />;

  const L = VOUCHER_CARD_LABELS[lang];
  const page = PROMOTION_VOUCHER_PAGE_I18N[lang];
  const cardData = voucherCardFromPass(p, lang);
  const benefitLabel = L.benefit(cardData.benefit);
  const conditions = formatPromotionConditions(p.conditionsSummary, lang);
  const conditionText = conditions.length ? L.conditionPrefix(conditions.join('; ')) : null;
  const campaignName = pickPromotionText(p.campaign.name, p.campaign.nameI18n, lang);
  const brandName = contact?.brandName ?? 'ORIA SPA';
  const hotline = contact?.hotline;
  const address = contact?.address;
  const website = (contact?.websiteUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const hasContact = Boolean(hotline || address || website);

  const renderCardFaces = (forPrint = false) => (
    <div className={forPrint ? '' : 'flex flex-col lg:flex-row items-center justify-center gap-8 py-4'}>
      {/* ──────────────── MẶT TRƯỚC (FRONT: ĐẦY ĐỦ THÂN VÉ + CUỐNG VÉ NHƯ EVOUCHER GỐC) ──────────────── */}
      <div className={forPrint ? '' : 'flex flex-col items-center gap-2'}>
        {!forPrint && (
          <span className="text-xs font-bold uppercase tracking-wider text-amber-900 bg-amber-100 px-3 py-1 rounded-full">
            Mặt Trước — Chuẩn E-Voucher Oria (90 x 55 mm)
          </span>
        )}
        <article
          className={`card-sheet card-sheet-front relative flex flex-col justify-between overflow-hidden text-[#2B1A0E] select-none ${
            forPrint ? '' : 'rounded-2xl shadow-xl border border-amber-900/20'
          }`}
          style={{
            width: '90mm',
            height: '55mm',
            ...FRONT_BOARD,
            color: ORIA.ink,
          }}
          lang={lang}
        >
          {/* Botanical ornaments (đúng tỉ lệ & vị trí như VoucherCard3D) */}
          <Sprig className="pointer-events-none absolute -left-[5%] top-[16%] w-[22%] rotate-[100deg] opacity-85" />
          <Sprig className="pointer-events-none absolute left-[22%] -top-[4%] w-[24%] rotate-[6deg] opacity-80" />
          <Sprig className="pointer-events-none absolute -right-[4%] -top-[4%] w-[16%] -scale-x-100 rotate-[160deg] opacity-80" />
          <SpaStill
            className="pointer-events-none absolute w-[28%] opacity-90"
            style={{ right: `${STUB_PERCENT + 1}%`, bottom: hasContact ? '18%' : '5%' }}
          />
          <Mortar
            className="pointer-events-none absolute -right-[2%] w-[18%] opacity-85"
            style={{ bottom: hasContact ? '17%' : '4%' }}
          />

          {/* Vết khuyết vé (Ticket Notches) cắt vào mép trên/dưới tại rãnh xé */}
          <div
            className="pointer-events-none absolute -top-2 w-3.5 h-3.5 rounded-full bg-white z-20"
            style={{ right: `calc(${STUB_PERCENT}% - 7px)` }}
          />
          {!hasContact && (
            <div
              className="pointer-events-none absolute -bottom-2 w-3.5 h-3.5 rounded-full bg-white z-20"
              style={{ right: `calc(${STUB_PERCENT}% - 7px)` }}
            />
          )}

          {/* NỘI DUNG 2 PHẦN: THÂN VÉ (73%) + ĐƯỜNG XÉ + CUỐNG VÉ (27%) */}
          <div className="relative z-10 flex min-h-0 flex-1">
            {/* 1. THÂN VÉ BÊN TRÁI (MAIN BODY ~73%) */}
            <div className="flex min-w-0 flex-1 flex-col justify-between p-2.5 pr-2">
              {/* Header thương hiệu + badge */}
              <div className="flex items-center justify-between gap-1">
                <span className="whitespace-nowrap text-[8.5px] font-extrabold uppercase tracking-[0.22em] text-[#2B1A0E]">
                  {brandName}
                </span>
                <span
                  className="whitespace-nowrap rounded-full px-2 py-0.5 text-[7px] font-bold uppercase tracking-[0.12em] shadow-sm"
                  style={{ backgroundColor: ORIA.ink, color: ORIA.creamText }}
                >
                  {cardData.isTemplate ? L.template : L.eVoucher}
                </span>
              </div>

              {/* Tên chiến dịch + Ưu đãi lớn + Điều kiện */}
              <div className="min-w-0 my-auto py-0.5">
                <p className="line-clamp-1 text-[8.5px] font-semibold leading-tight" style={{ color: ORIA.inkSoft }}>
                  {campaignName || L.untitled}
                </p>
                <p
                  className={`${voucherBrush.className} whitespace-nowrap text-[25px] leading-[0.95] uppercase [text-shadow:0_1px_0_rgba(255,226,160,0.55)]`}
                  style={{ color: ORIA.ink }}
                >
                  {benefitLabel}
                </p>
                {conditionText ? (
                  <p className="mt-0.5 line-clamp-1 text-[7.5px] font-medium leading-tight" style={{ color: ORIA.inkSoft }}>
                    {conditionText}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[7px] font-semibold uppercase tracking-[0.18em]" style={{ color: ORIA.inkSoft }}>
                    {L.complimentary}
                  </p>
                )}
              </div>

              {/* Mã Voucher + Hạn sử dụng */}
              <div className="space-y-0.5 text-[7.5px] leading-tight">
                <div>
                  <span className="font-semibold uppercase tracking-wider" style={{ color: ORIA.inkSoft }}>{L.voucherCode}: </span>
                  <span className="whitespace-nowrap font-mono text-[9.5px] font-bold tracking-wider text-[#2B1A0E]">{p.voucherCode}</span>
                </div>
                <div style={{ color: ORIA.inkSoft }}>
                  {L.validUntil}: <span className="font-bold text-[#2B1A0E]">{p.validUntil ? formatPromoDate(p.validUntil) : '—'}</span>
                </div>
              </div>
            </div>

            {/* RÃNH XÉ RĂNG CƯA (PERFORATION LINE) */}
            <div aria-hidden className="my-2 border-l border-dashed border-[#FFF4E0]/85" />

            {/* 2. CUỐNG VÉ BÊN PHẢI (STUB ~27%) */}
            <div
              className="flex shrink-0 flex-col items-center justify-between py-2 px-1.5 text-center"
              style={{ width: `${STUB_PERCENT}%` }}
            >
              <span className="line-clamp-1 text-[7px] font-bold uppercase tracking-wider text-[#2B1A0E]">
                {cardData.isTemplate ? L.forCustomer : (p.customer.name || brandName)}
              </span>
              <span
                className="flex items-center justify-center rounded-lg p-1 shadow-sm ring-1 ring-[#2B1A0E]/15"
                style={{ backgroundColor: ORIA.cream }}
              >
                {p.qrPayload ? (
                  <QRCodeSVG
                    value={p.qrPayload}
                    size={STUB_QR_SIZE}
                    marginSize={0}
                    level="M"
                    fgColor={ORIA.ink}
                    bgColor={ORIA.cream}
                    className="h-auto w-full"
                  />
                ) : (
                  <div className="w-[42px] h-[42px] flex items-center justify-center text-[7px] text-gray-400">QR</div>
                )}
              </span>
              <span
                className="rounded-md px-1.5 py-0.5 text-[6.5px] font-bold leading-none tracking-wide"
                style={{ backgroundColor: 'rgba(43,26,14,0.85)', color: ORIA.creamText }}
              >
                {L.usage(p.usage)}
              </span>
            </div>
          </div>

          {/* DẢI BĂNG LIÊN HỆ ĐÁY THẺ (CONTACT FOOTER BAND NÂU ĐẬM) */}
          {hasContact && (
            <div
              className="relative z-10 flex shrink-0 items-center justify-between px-3 py-1 text-[7px] border-t border-[#F4A64A]/30"
              style={{ backgroundColor: ORIA.band, color: ORIA.bandText }}
            >
              {hotline && (
                <span className="inline-flex items-center gap-1 font-bold">
                  <Phone size={8} aria-hidden />
                  {hotline}
                </span>
              )}
              {address && (
                <span className="inline-flex items-center gap-1 truncate max-w-[50%]">
                  <MapPin size={8} className="shrink-0" aria-hidden />
                  <span className="truncate">{address}</span>
                </span>
              )}
              {website && (
                <span className="inline-flex items-center gap-1">
                  <Globe size={8} className="shrink-0" aria-hidden />
                  <span>{website}</span>
                </span>
              )}
            </div>
          )}
        </article>
      </div>

      {/* ──────────────── MẶT SAU (BACK: GIẤY NGÀ CHI TIẾT + QR LỚN + ĐIỀU KIỆN) ──────────────── */}
      <div className={forPrint ? '' : 'flex flex-col items-center gap-2'}>
        {!forPrint && (
          <span className="text-xs font-bold uppercase tracking-wider text-amber-900 bg-amber-100 px-3 py-1 rounded-full">
            Mặt Sau — Điều Kiện & Tra Cứu (90 x 55 mm)
          </span>
        )}
        <article
          className={`card-sheet card-sheet-back relative flex flex-col justify-between overflow-hidden text-[#2B1A0E] select-none ${
            forPrint ? '' : 'rounded-2xl shadow-xl border border-amber-900/20'
          }`}
          style={{
            width: '90mm',
            height: '55mm',
            ...BACK_PAPER,
            color: ORIA.ink,
          }}
          lang={lang}
        >
          {/* Botanical ornaments */}
          <Sprig className="pointer-events-none absolute -right-2 -top-2 w-[22%] -scale-x-100 rotate-[175deg] opacity-75" />
          <Cinnamon className="pointer-events-none absolute right-[2%] bottom-[16%] w-[15%] opacity-80" />

          {/* Body: Cột trái QR lớn + Mã, Cột phải Thông tin chi tiết */}
          <div className="relative z-10 flex flex-1 items-center gap-2.5 px-3 pt-2">
            {/* Cột trái: QR lớn ~20mm */}
            <div className="flex shrink-0 flex-col items-center gap-1">
              <div
                className="flex items-center justify-center rounded-xl p-1 shadow-sm ring-1 ring-[#2B1A0E]/15"
                style={{ backgroundColor: '#FFFDF7' }}
              >
                {p.qrPayload ? (
                  <QRCodeSVG
                    value={p.qrPayload}
                    size={BACK_QR_SIZE}
                    marginSize={1}
                    level="M"
                    fgColor={ORIA.ink}
                    bgColor="#FFFDF7"
                  />
                ) : (
                  <div className="h-[72px] w-[72px] flex items-center justify-center text-[8px] text-gray-400">
                    No QR
                  </div>
                )}
              </div>
              <span className="font-mono text-[9px] font-bold tracking-wider text-[#2B1A0E]">
                {p.voucherCode}
              </span>
            </div>

            {/* Cột phải: Thông tin & điều kiện sử dụng */}
            <div className="min-w-0 flex-1 space-y-1 text-[8px] leading-tight">
              <div>
                <p className={`${voucherBrush.className} text-[15px] leading-none text-[#2B1A0E]`}>
                  {brandName}
                </p>
                {p.customer.name && (
                  <p className="mt-0.5 font-bold truncate text-[#2B1A0E]">
                    {L.forCustomer}: <span className="font-semibold">{p.customer.name}</span>
                  </p>
                )}
              </div>

              <div>
                <span className="font-semibold" style={{ color: ORIA.inkSoft }}>
                  {page.validUntil}:
                </span>{' '}
                <span className="font-bold text-[#2B1A0E]">{p.validUntil ? formatPromoDate(p.validUntil) : '—'}</span>
              </div>

              <div>
                <span className="font-semibold" style={{ color: ORIA.inkSoft }}>
                  {page.applicableMenus}:
                </span>{' '}
                <span className="font-medium line-clamp-2">
                  {conditions.length ? conditions.join('; ') : page.allMenus}
                </span>
              </div>

              <p className="line-clamp-1 italic text-[7.5px]" style={{ color: ORIA.inkSoft }}>
                {L.qrInstruction}
              </p>
            </div>
          </div>

          {/* Dải chân trang thông tin liên hệ */}
          {hasContact && (
            <div
              className="relative z-10 flex items-center justify-between px-3 py-1 text-[7px] font-medium border-t border-[#F4A64A]/30"
              style={{ backgroundColor: ORIA.band, color: ORIA.bandText }}
            >
              {hotline && (
                <span className="inline-flex items-center gap-1 font-bold">
                  <Phone size={8} aria-hidden />
                  {hotline}
                </span>
              )}
              {address && (
                <span className="inline-flex items-center gap-1 truncate max-w-[50%]">
                  <MapPin size={8} className="shrink-0" aria-hidden />
                  <span className="truncate">{address}</span>
                </span>
              )}
              {website && (
                <span className="inline-flex items-center gap-1">
                  <Globe size={8} className="shrink-0" aria-hidden />
                  <span>{website}</span>
                </span>
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <style>{PRINT_CARD_CSS}</style>

      {/* Thanh điều khiển */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
        >
          <ArrowLeft size={18} aria-hidden />
          {t.print.back}
        </button>
        <VoucherLangTabs value={lang} onChange={setLang} label={t.voucher.viewIn} />
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 shadow-sm"
        >
          <Printer size={18} aria-hidden />
          {t.print.printCard}
        </button>
      </div>

      <div className="rounded-xl bg-amber-50/70 border border-amber-200/60 p-3 text-xs text-amber-900 print:hidden flex items-center justify-between">
        <span>💡 {t.print.hintCard}</span>
        <span className="font-semibold text-amber-800">Khổ chuẩn: 90 x 55 mm (2 mặt)</span>
      </div>

      {/* Khung xem trước trên màn hình */}
      <div className="print:hidden">
        {renderCardFaces(false)}
      </div>

      {/* Bản in được gắn trực tiếp vào <body> */}
      <PrintRoot>
        {renderCardFaces(true)}
      </PrintRoot>
    </div>
  );
};

const VoucherCardPrintPage = () => (
  <PromotionsShell action={'pass.view'} title={t.print.titleCard} bare>
    <Suspense fallback={<PromotionLoading />}>
      <VoucherCardPrint />
    </Suspense>
  </PromotionsShell>
);

export default VoucherCardPrintPage;
