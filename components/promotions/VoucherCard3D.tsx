'use client';

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { Globe, MapPin, Phone, QrCode, RotateCw, Sparkles } from 'lucide-react';
import type { SpaContact } from '@/lib/types/promotion-client';
import { formatPromoDate } from '@/lib/promotion-format';
import { t } from './promotion.i18n';
import { VOUCHER_CARD_LABELS, type VoucherCardLabels } from './voucher-card.i18n';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';
import type { VoucherCardData } from './VoucherCard3D.logic';
import { Cinnamon, Mortar, SpaStill, Sprig } from './VoucherBotanicals';
import { BACK_PAPER, FRONT_BOARD, ORIA } from './voucher.theme';
import { voucherBrush } from './voucher.fonts';

// 🔧 UI CONFIGURATION
const CARD_ASPECT = 'aspect-[1.22/1] min-[400px]:aspect-[1.4/1] sm:aspect-[1.62/1]';
/** Taller when the spa contact strip is printed on the front. */
const CARD_ASPECT_WITH_CONTACT = 'aspect-[1.05/1] min-[400px]:aspect-[1.2/1] sm:aspect-[1.42/1]';
const MAX_TILT_DEG = 12;
const TILT_SPRING = { stiffness: 220, damping: 20, mass: 0.6 };
const FLIP_SPRING = { stiffness: 140, damping: 18 };
const STUB_RATIO = 0.27; // right stub width (perforation position)
const NOTCH_RADIUS_PX = 12;
const BACK_QR_SIZE = 148;
const STUB_QR_SIZE = 64;
const PLACEHOLDER_CODE_LENGTH = 6;

/** Ticket notches at the perforation line (mask = static shape, not styling). */
const NOTCH_MASK = `radial-gradient(circle at ${(1 - STUB_RATIO) * 100}% 0, transparent ${NOTCH_RADIUS_PX}px, #000 ${NOTCH_RADIUS_PX + 0.5}px), radial-gradient(circle at ${(1 - STUB_RATIO) * 100}% 100%, transparent ${NOTCH_RADIUS_PX}px, #000 ${NOTCH_RADIUS_PX + 0.5}px)`;
/** With the contact strip at the bottom only the top notch is cut, so the address is never bitten. */
const NOTCH_MASK_TOP = `radial-gradient(circle at ${(1 - STUB_RATIO) * 100}% 0, transparent ${NOTCH_RADIUS_PX}px, #000 ${NOTCH_RADIUS_PX + 0.5}px)`;
const NOTCH_STYLE_TOP: React.CSSProperties = { WebkitMaskImage: NOTCH_MASK_TOP, maskImage: NOTCH_MASK_TOP };
const NOTCH_STYLE: React.CSSProperties = {
  WebkitMaskImage: NOTCH_MASK,
  maskImage: NOTCH_MASK,
  WebkitMaskComposite: 'source-in',
  maskComposite: 'intersect',
};

type CardContact = Pick<SpaContact, 'hotline' | 'address' | 'websiteUrl'>;

/** Hotline · website / address — icons only, readable in every language. */
const ContactLines = ({ contact }: { contact: CardContact }) => (
  <div className="grid gap-0.5 text-[9px] leading-tight min-[400px]:text-[10px] sm:text-[11px]" style={{ color: ORIA.bandText }}>
    <div className="flex min-w-0 items-center gap-x-2 min-[400px]:gap-x-3">
      {contact.hotline && (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-semibold">
          <Phone size={11} aria-hidden />
          {contact.hotline}
        </span>
      )}
      {contact.websiteUrl && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <Globe size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{contact.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
        </span>
      )}
    </div>
    {contact.address && (
      <span className="inline-flex min-w-0 items-center gap-1">
        <MapPin size={11} className="shrink-0" aria-hidden />
        <span className="truncate">{contact.address}</span>
      </span>
    )}
  </div>
);

interface VoucherCard3DProps {
  data: VoucherCardData;
  /** Card text; admin = vi, public /voucher page = customer language. */
  labels?: VoucherCardLabels;
  /** Brand printed on the card; defaults to the system spa name. */
  brandName?: string;
  /** Hotline / website / address printed on the back of the card. */
  contact?: CardContact | null;
  /** Hint line under the card ("tap to flip"). */
  showHint?: boolean;
  className?: string;
}

/**
 * 3D e-voucher card — same face the customer sees, so staff can compare it with
 * the customer's screen / email. Tilts with the pointer, taps to flip to the QR.
 * Renders server data only; the template mode masks the code (no code is made here).
 */
const VoucherCard3D = ({ data, labels = VOUCHER_CARD_LABELS.vi, brandName = t.voucher.brand, contact = null, showHint = true, className = '' }: VoucherCard3DProps) => {
  const L = labels;
  const hasContact = !!(contact && (contact.hotline || contact.address || contact.websiteUrl));
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);

  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const tiltX = useSpring(useTransform(py, [0, 1], [MAX_TILT_DEG, -MAX_TILT_DEG]), TILT_SPRING);
  const tiltY = useSpring(useTransform(px, [0, 1], [-MAX_TILT_DEG, MAX_TILT_DEG]), TILT_SPRING);
  const flip = useSpring(0, FLIP_SPRING);
  const rotateY = useTransform(() => tiltY.get() + flip.get());
  const glareX = useTransform(px, [0, 1], ['0%', '100%']);
  const glareY = useTransform(py, [0, 1], ['0%', '100%']);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.35), rgba(255,255,255,0) 55%)`;
  const shadowX = useTransform(tiltY, [-MAX_TILT_DEG, MAX_TILT_DEG], [18, -18]);
  const shadowY = useTransform(tiltX, [-MAX_TILT_DEG, MAX_TILT_DEG], [-6, 30]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || e.pointerType === 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const resetTilt = () => {
    px.set(0.5);
    py.set(0.5);
  };
  const toggleFlip = () => {
    const next = !flipped;
    setFlipped(next);
    if (reduceMotion) flip.jump(next ? 180 : 0);
    else flip.set(next ? 180 : 0);
  };

  const inactive = data.status !== null && data.status !== 'ACTIVE';
  const code = data.voucherCode ?? `${data.voucherPrefix || 'CODE'}-${'•'.repeat(PLACEHOLDER_CODE_LENGTH)}`;
  const benefitLabel = L.benefit(data.benefit);
  // Wording comes from the engine (same sentence as the e-mail and the /voucher page).
  const conditionLines = formatPromotionConditions(data.conditionsSummary, L.lang);
  const conditionText = conditionLines.length ? L.conditionPrefix(conditionLines.join('; ')) : null;
  const flipLabel = flipped ? L.showFront : L.showBack;

  return (
    <div className={`w-full max-w-[440px] ${className}`}>
      <div className="relative perspective-[1200px]" onPointerMove={onPointerMove} onPointerLeave={resetTilt}>
        {/* Soft floor shadow that drifts against the tilt */}
        <motion.div
          aria-hidden
          className="absolute inset-x-6 bottom-0 top-6 rounded-[28px] bg-[#5A260A]/45 blur-2xl"
          style={{ x: shadowX, y: shadowY }}
        />

        <motion.button
          type="button"
          onClick={toggleFlip}
          aria-pressed={flipped}
          aria-label={`${data.campaignName || L.untitled} — ${flipLabel}`}
          className={`relative block w-full cursor-pointer rounded-[24px] text-left transform-3d focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 ${hasContact ? CARD_ASPECT_WITH_CONTACT : CARD_ASPECT}`}
          style={{ rotateX: reduceMotion ? 0 : tiltX, rotateY }}
        >
          {/* FRONT — painted amber board (Oria Spa shop sign) */}
          <div
            className={`absolute inset-0 overflow-hidden rounded-[24px] shadow-[0_24px_48px_-16px_rgba(90,38,10,0.6),0_2px_6px_rgba(90,38,10,0.3)] backface-hidden ${inactive ? 'grayscale-[0.75] sepia-[0.2]' : ''}`}
            style={{ ...FRONT_BOARD, ...(hasContact ? NOTCH_STYLE_TOP : NOTCH_STYLE), color: ORIA.ink }}
          >
            {/* Botanical ornaments (behind the text) */}
            {/* Ornaments stay in the margins: left edge, top centre, stub corner, bottom-right of the main area. */}
            <Sprig className="pointer-events-none absolute -left-[7%] top-[24%] w-[20%] rotate-[100deg] opacity-90" />
            <Sprig className="pointer-events-none absolute left-[24%] -top-[3%] w-[24%] rotate-[6deg] opacity-85" />
            <Sprig className="pointer-events-none absolute -right-[4%] -top-[4%] w-[15%] -scale-x-100 rotate-[160deg] opacity-85" />
            <SpaStill
              className="pointer-events-none absolute hidden w-[30%] opacity-95 min-[360px]:block sm:w-[33%]"
              style={{ right: `${STUB_RATIO * 100 + 1.5}%`, bottom: hasContact ? '18%' : '4%' }}
            />
            <Mortar className="pointer-events-none absolute -right-[1%] hidden w-[19%] opacity-90 min-[360px]:block" style={{ bottom: hasContact ? '17%' : '2%' }} />

            <div className="relative flex h-full flex-col">
            <div className="flex min-h-0 flex-1">
              {/* Main area */}
              <div className="flex min-w-0 flex-1 flex-col justify-between p-[6%]">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.2em] sm:text-[11px] sm:tracking-[0.32em]">{brandName}</span>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] shadow-sm sm:tracking-[0.18em]"
                    style={{ backgroundColor: ORIA.ink, color: ORIA.creamText }}
                  >
                    {data.isTemplate ? L.template : L.eVoucher}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="line-clamp-2 text-[12px] font-semibold leading-snug sm:text-[13px]" style={{ color: ORIA.inkSoft }}>
                    {data.campaignName || L.untitled}
                  </p>
                  <p
                    className={`${voucherBrush.className} mt-0.5 whitespace-nowrap text-[clamp(24px,8.6vw,50px)] uppercase leading-[0.95] [text-shadow:0_1px_0_rgba(255,226,160,0.55)]`}
                    style={{ color: ORIA.ink }}
                  >
                    {benefitLabel}
                  </p>
                  {conditionText ? (
                    <p className="mt-1 line-clamp-2 max-w-[92%] text-[11px] font-semibold leading-snug" style={{ color: ORIA.inkSoft }}>
                      {conditionText}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: ORIA.inkSoft }}>
                      {L.complimentary}
                    </p>
                  )}
                </div>

                {/* Code gets its own full line: it is what staff read back to the customer */}
                <div className="space-y-1.5 text-[10px] leading-tight">
                  <div>
                    <p className="font-semibold uppercase tracking-wider" style={{ color: ORIA.inkSoft }}>{L.voucherCode}</p>
                    <p className="whitespace-nowrap font-mono text-[clamp(12px,3.6vw,15px)] font-bold tracking-[0.06em] sm:tracking-[0.12em]">{code}</p>
                  </div>
                  <p style={{ color: ORIA.inkSoft }}>
                    {L.validUntil} <span className="font-bold" style={{ color: ORIA.ink }}>{data.validUntil ? formatPromoDate(data.validUntil) : '—'}</span>
                  </p>
                </div>
              </div>

              {/* Perforation */}
              <div aria-hidden className="my-4 border-l-2 border-dashed border-[#FFF4E0]/85" />

              {/* Stub */}
              <div className="flex shrink-0 flex-col items-center justify-between py-[6%] pr-[4%] pl-[3%]" style={{ width: `${STUB_RATIO * 100}%` }}>
                <span className="text-center text-[9px] font-bold uppercase leading-tight tracking-wider">
                  {data.isTemplate ? L.forCustomer : (data.customerName ?? '')}
                </span>
                <span
                  className="flex w-full items-center justify-center rounded-xl p-1.5 shadow-[0_2px_8px_rgba(90,38,10,0.35)] ring-1 ring-[#2B1A0E]/15"
                  style={{ maxWidth: STUB_QR_SIZE + 12, backgroundColor: ORIA.cream }}
                >
                  {data.qrPayload && !inactive ? (
                    <QRCodeSVG value={data.qrPayload} size={STUB_QR_SIZE} marginSize={0} level="M" fgColor={ORIA.ink} bgColor={ORIA.cream} className="h-auto w-full" />
                  ) : (
                    <QrCode size={STUB_QR_SIZE * 0.75} className="h-auto w-3/4" style={{ color: ORIA.inkSoft }} aria-hidden />
                  )}
                </span>
                <span className="rounded-lg px-1.5 py-0.5 text-center text-[8px] font-semibold leading-tight min-[400px]:rounded-full min-[400px]:px-2 min-[400px]:text-[9px]" style={{ backgroundColor: 'rgba(43,26,14,0.85)', color: ORIA.creamText }}>
                  {L.usage(data.usage)}
                </span>
              </div>
            </div>
            {/* Dark footer band with orange text — like the bottom of the shop sign */}
            {hasContact && contact && (
              <div className="relative shrink-0 border-t border-[#F4A64A]/30 px-[6%] py-[2.5%]" style={{ backgroundColor: ORIA.band }}>
                <ContactLines contact={contact} />
              </div>
            )}
            </div>

            {/* Status stamp */}
            {inactive && data.status && (
              <span
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-4 px-4 py-1 text-xl font-black uppercase tracking-widest"
                style={{ borderColor: 'rgba(43,26,14,0.85)', color: 'rgba(43,26,14,0.9)', backgroundColor: 'rgba(255,244,224,0.35)' }}
              >
                {L.status[data.status]}
              </span>
            )}

            {!reduceMotion && <motion.div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: glare }} />}
          </div>

          {/* BACK — warm parchment */}
          <div
            className="absolute inset-0 flex flex-col overflow-hidden rounded-[24px] shadow-[0_24px_48px_-16px_rgba(90,38,10,0.5)] backface-hidden rotate-y-180"
            style={{ ...BACK_PAPER, color: ORIA.ink }}
          >
            <Sprig className="pointer-events-none absolute -right-2 -top-2 w-[26%] -scale-x-100 rotate-[175deg] opacity-80" />
            <Cinnamon className="pointer-events-none absolute right-[3%] w-[18%] opacity-85" style={{ bottom: hasContact ? '19%' : '4%' }} />
            <div className="relative flex min-h-0 flex-1 items-center gap-[5%] p-[5%]">
            <span
              className={`flex shrink-0 items-center justify-center rounded-2xl p-1.5 shadow-sm ring-1 ring-[#2B1A0E]/15 ${hasContact ? 'w-[34%]' : 'w-[42%]'}`}
              style={{ backgroundColor: '#FFFDF7' }}
            >
              {data.qrPayload && !inactive ? (
                <QRCodeSVG value={data.qrPayload} size={BACK_QR_SIZE} marginSize={1} level="M" fgColor={ORIA.ink} bgColor="#FFFDF7" className="h-auto w-full" />
              ) : (
                <span className="flex aspect-square w-full flex-col items-center justify-center gap-2 text-center text-[11px]" style={{ color: ORIA.inkSoft }}>
                  <QrCode size={48} aria-hidden />
                  {data.isTemplate ? L.qrOnIssue : L.qrUnavailable}
                </span>
              )}
            </span>
            <div className="min-w-0 space-y-1.5">
              <p className={`${voucherBrush.className} whitespace-nowrap text-[clamp(18px,5vw,24px)] leading-none`}>{brandName}</p>
              <p className="whitespace-nowrap font-mono text-[clamp(12px,3.4vw,14px)] font-bold tracking-[0.04em] sm:tracking-[0.12em]">{code}</p>
              <p className="line-clamp-3 text-[11px] leading-snug sm:text-[12px]" style={{ color: ORIA.inkSoft }}>{L.qrInstruction}</p>
              {data.status && <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: ORIA.amberDark }}>{L.status[data.status]}</p>}
            </div>
            </div>
            {/* Spa contact band: icons only, so it reads the same in every language. */}
            {hasContact && contact && (
              <div className="relative shrink-0 px-[5%] py-[2.5%]" style={{ backgroundColor: ORIA.band }}>
                <ContactLines contact={contact} />
              </div>
            )}
          </div>
        </motion.button>
      </div>

      {showHint && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-500">
          {flipped ? <RotateCw size={14} aria-hidden /> : <Sparkles size={14} aria-hidden />}
          {flipped ? L.hintBack : L.hintFront}
        </p>
      )}
    </div>
  );
};

export default VoucherCard3D;
