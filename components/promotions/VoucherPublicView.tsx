import React from 'react';
import { AlertTriangle, Globe, MapPin, Phone } from 'lucide-react';
import type { PromotionEmailLang, PromotionPassEffectiveStatus } from '@/lib/types/promotion-client';
import { formatPromoDate } from '@/lib/promotion-format';
import VoucherCardLocalized from './VoucherCardLocalized';
import { voucherCardFromPublic, type PublicVoucher } from './VoucherCard3D.logic';
import { VOUCHER_CARD_LABELS, VOUCHER_LANG_NAMES } from './voucher-card.i18n';
import { voucherBrush } from './voucher.fonts';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';

// 🔧 UI CONFIGURATION

/** Spa contact block (Agent A `VoucherContact`, from the email config). */
export interface VoucherContact {
  brandName: string;
  logoUrl: string | null;
  hotline: string | null;
  address: string | null;
  websiteUrl: string | null;
}

/** Page copy in one language (Agent A `PromotionVoucherPageStrings`). */
export interface VoucherPageStrings {
  title: string;
  contactToApply: (brand: string) => string;
  invalidTitle: string;
  invalidBody: (brand: string) => string;
  status: Record<PromotionPassEffectiveStatus, string>;
  validUntil: string;
  hotline: string;
  address: string;
  applicableMenus: string;
  allMenus: string;
}

export type PublicVoucherView =
  | { mode: 'CUSTOMER'; voucher: PublicVoucher; contact: VoucherContact }
  | { mode: 'INVALID'; contact: VoucherContact };

interface VoucherPublicViewProps {
  view: PublicVoucherView;
  strings: VoucherPageStrings;
  lang: PromotionEmailLang;
  /** Token from the URL, kept when switching language. */
  token: string;
  langs: PromotionEmailLang[];
}

/** Same sentence as on the card: "Dành cho Menu VIP từ 90 phút trở lên". */
const conditionText = (v: PublicVoucher, lang: PromotionEmailLang, s: VoucherPageStrings): string => {
  const lines = formatPromotionConditions(v.conditionsSummary, lang);
  return lines.length ? lines.join('; ') : s.allMenus;
};

/**
 * Customer-facing e-voucher page (/voucher?t=). Shown to anyone who opens the
 * QR link; staff are redirected to the scanner by the server before this renders.
 * Mobile-first, no admin chrome, no personal data beyond the name on the card.
 */
const VoucherPublicView = ({ view, strings, lang, token, langs }: VoucherPublicViewProps) => {
  const { contact } = view;
  const href = (l: PromotionEmailLang) => `?t=${encodeURIComponent(token)}&lang=${l}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#FFF4E0] via-[#FCE6C2] to-[#F6CF94] px-4 pb-12 pt-6 text-[#2B1A0E]">
      <div className="mx-auto flex max-w-md flex-col items-center">
        <header className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {contact.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={contact.logoUrl} alt={contact.brandName} className="h-9 w-auto max-w-[140px] object-contain" />
            ) : (
              <span className={`${voucherBrush.className} truncate text-2xl leading-none text-[#2B1A0E]`}>{contact.brandName}</span>
            )}
          </div>
          <nav aria-label="Language" className="flex shrink-0 gap-1">
            {langs.map((l) => (
              <a
                key={l}
                href={href(l)}
                aria-current={l === lang ? 'true' : undefined}
                className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs font-semibold ${l === lang ? 'bg-[#2B1A0E] text-[#F7D9A6]' : 'text-[#4A2C14] hover:bg-[#FFF4E0]'}`}
              >
                {VOUCHER_LANG_NAMES[l]}
              </a>
            ))}
          </nav>
        </header>

        {view.mode === 'INVALID' ? (
          <section role="alert" className="mt-16 w-full rounded-3xl border border-[#E9C99A] bg-[#FFF8EC] p-8 text-center shadow-sm">
            <AlertTriangle size={40} className="mx-auto text-[#B4531A]" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold">{strings.invalidTitle}</h1>
            <p className="mt-2 text-sm text-[#4A2C14]">{strings.invalidBody(contact.brandName)}</p>
          </section>
        ) : (
          <>
            <h1 className={`${voucherBrush.className} mb-6 mt-8 text-center text-4xl leading-none text-[#2B1A0E]`}>{strings.title}</h1>
            <VoucherCardLocalized data={voucherCardFromPublic(view.voucher, lang)} lang={lang} brandName={contact.brandName} contact={contact} />

            <dl className="mt-8 w-full divide-y divide-[#F0D9B5] rounded-2xl border border-[#E9C99A] bg-[#FFF8EC]/90 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-[#6B4A2A]">{VOUCHER_CARD_LABELS[lang].voucherCode}</dt>
                <dd className="font-mono font-semibold tracking-wider">{view.voucher.voucherCode}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-[#6B4A2A]">{strings.validUntil}</dt>
                <dd className="font-medium">{formatPromoDate(view.voucher.validUntil)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="shrink-0 text-[#6B4A2A]">{strings.applicableMenus}</dt>
                <dd className="text-right font-medium">{conditionText(view.voucher, lang, strings)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-[#6B4A2A]">{VOUCHER_CARD_LABELS[lang].statusLabel}</dt>
                <dd className={`font-semibold ${view.voucher.effectiveStatus === 'ACTIVE' ? 'text-[#3E6B1E]' : 'text-[#6B3410]'}`}>
                  {strings.status[view.voucher.effectiveStatus] ?? view.voucher.effectiveStatus}
                </dd>
              </div>
            </dl>

            <p className="mt-6 text-center text-sm font-semibold text-[#4A2C14]">{strings.contactToApply(contact.brandName)}</p>
          </>
        )}

        {(contact.hotline || contact.address || contact.websiteUrl) && (
          <section className="mt-4 flex w-full flex-col gap-2">
            {contact.hotline && (
              <a href={`tel:${contact.hotline.replace(/\s+/g, '')}`} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#24160D] px-4 text-sm font-semibold text-[#F4A64A] shadow-sm">
                <Phone size={18} aria-hidden />
                {strings.hotline}: {contact.hotline}
              </a>
            )}
            {contact.address && (
              <p className="flex items-start justify-center gap-2 px-2 text-center text-sm text-[#4A2C14]">
                <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {strings.address}: {contact.address}
                </span>
              </p>
            )}
            {contact.websiteUrl && (
              <a href={contact.websiteUrl} className="flex min-h-11 items-center justify-center gap-2 text-sm font-medium text-[#6B3410]" rel="noopener">
                <Globe size={16} aria-hidden />
                {contact.websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </section>
        )}
      </div>
    </main>
  );
};

export default VoucherPublicView;
