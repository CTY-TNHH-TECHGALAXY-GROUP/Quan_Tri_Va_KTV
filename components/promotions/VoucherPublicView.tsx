'use client';

import React from 'react';
import { AlertTriangle, Globe, MapPin, Phone } from 'lucide-react';
import type { PromotionEmailLang, PromotionPassEffectiveStatus } from '@/lib/types/promotion-client';
import { formatPromoDate } from '@/lib/promotion-format';
import VoucherCard3D from './VoucherCard3D';
import { voucherCardFromPublic, type PublicVoucher } from './VoucherCard3D.logic';
import { VOUCHER_CARD_LABELS } from './voucher-card.i18n';

// 🔧 UI CONFIGURATION
const LANG_NAMES: Record<PromotionEmailLang, string> = { vi: 'VI', en: 'EN', cn: '中文', jp: '日本語', kr: '한국어' };

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

const menusText = (v: PublicVoucher, s: VoucherPageStrings): string => {
  const m = v.applicableMenus;
  if (m.allMenus || (!m.menus.length && !m.categories.length && !m.serviceIds.length)) return s.allMenus;
  const names = v.menuLabels?.length ? v.menuLabels : m.categories.length ? m.categories : m.menus;
  return names.join(', ');
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
    <main className="min-h-screen bg-gradient-to-b from-[#f6f3ff] via-white to-[#fbf7ef] px-4 pb-12 pt-6 text-gray-900">
      <div className="mx-auto flex max-w-md flex-col items-center">
        <header className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {contact.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={contact.logoUrl} alt={contact.brandName} className="h-9 w-auto max-w-[140px] object-contain" />
            ) : (
              <span className="truncate text-sm font-semibold uppercase tracking-[0.25em] text-indigo-900">{contact.brandName}</span>
            )}
          </div>
          <nav aria-label="Language" className="flex shrink-0 gap-1">
            {langs.map((l) => (
              <a
                key={l}
                href={href(l)}
                aria-current={l === lang ? 'true' : undefined}
                className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs font-semibold ${l === lang ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-white'}`}
              >
                {LANG_NAMES[l]}
              </a>
            ))}
          </nav>
        </header>

        {view.mode === 'INVALID' ? (
          <section role="alert" className="mt-16 w-full rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-sm">
            <AlertTriangle size={40} className="mx-auto text-rose-500" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold">{strings.invalidTitle}</h1>
            <p className="mt-2 text-sm text-gray-600">{strings.invalidBody(contact.brandName)}</p>
          </section>
        ) : (
          <>
            <h1 className="mb-6 mt-8 text-center text-2xl font-semibold tracking-tight">{strings.title}</h1>
            <VoucherCard3D data={voucherCardFromPublic(view.voucher)} labels={VOUCHER_CARD_LABELS[lang]} brandName={contact.brandName} />

            <dl className="mt-8 w-full divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white/80 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-gray-500">{VOUCHER_CARD_LABELS[lang].voucherCode}</dt>
                <dd className="font-mono font-semibold tracking-wider">{view.voucher.voucherCode}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-gray-500">{strings.validUntil}</dt>
                <dd className="font-medium">{formatPromoDate(view.voucher.validUntil)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="shrink-0 text-gray-500">{strings.applicableMenus}</dt>
                <dd className="text-right font-medium">{menusText(view.voucher, strings)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-gray-500">{VOUCHER_CARD_LABELS[lang].statusLabel}</dt>
                <dd className={`font-semibold ${view.voucher.effectiveStatus === 'ACTIVE' ? 'text-emerald-700' : 'text-gray-700'}`}>
                  {strings.status[view.voucher.effectiveStatus] ?? view.voucher.effectiveStatus}
                </dd>
              </div>
            </dl>

            <p className="mt-6 text-center text-sm font-medium text-indigo-900">{strings.contactToApply(contact.brandName)}</p>
          </>
        )}

        {(contact.hotline || contact.address || contact.websiteUrl) && (
          <section className="mt-4 flex w-full flex-col gap-2">
            {contact.hotline && (
              <a href={`tel:${contact.hotline.replace(/\s+/g, '')}`} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm">
                <Phone size={18} aria-hidden />
                {strings.hotline}: {contact.hotline}
              </a>
            )}
            {contact.address && (
              <p className="flex items-start justify-center gap-2 px-2 text-center text-sm text-gray-600">
                <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {strings.address}: {contact.address}
                </span>
              </p>
            )}
            {contact.websiteUrl && (
              <a href={contact.websiteUrl} className="flex min-h-11 items-center justify-center gap-2 text-sm font-medium text-indigo-700" rel="noopener">
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
