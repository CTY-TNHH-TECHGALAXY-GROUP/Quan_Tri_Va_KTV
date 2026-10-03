'use client';

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { QrCode, RotateCw, Sparkles } from 'lucide-react';
import { formatPromoDate } from '@/lib/promotion-format';
import { t } from './promotion.i18n';
import { VOUCHER_CARD_LABELS, type VoucherCardLabels } from './voucher-card.i18n';
import type { VoucherCardData } from './VoucherCard3D.logic';

// 🔧 UI CONFIGURATION
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
const NOTCH_STYLE: React.CSSProperties = {
  WebkitMaskImage: NOTCH_MASK,
  maskImage: NOTCH_MASK,
  WebkitMaskComposite: 'source-in',
  maskComposite: 'intersect',
};

interface VoucherCard3DProps {
  data: VoucherCardData;
  /** Card text; admin = vi, public /voucher page = customer language. */
  labels?: VoucherCardLabels;
  /** Brand printed on the card; defaults to the system spa name. */
  brandName?: string;
  /** Hint line under the card ("tap to flip"). */
  showHint?: boolean;
  className?: string;
}

/**
 * 3D e-voucher card — same face the customer sees, so staff can compare it with
 * the customer's screen / email. Tilts with the pointer, taps to flip to the QR.
 * Renders server data only; the template mode masks the code (no code is made here).
 */
const VoucherCard3D = ({ data, labels = VOUCHER_CARD_LABELS.vi, brandName = t.voucher.brand, showHint = true, className = '' }: VoucherCard3DProps) => {
  const L = labels;
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
  const flipLabel = flipped ? L.showFront : L.showBack;

  return (
    <div className={`w-full max-w-[440px] ${className}`}>
      <div className="relative perspective-[1200px]" onPointerMove={onPointerMove} onPointerLeave={resetTilt}>
        {/* Soft floor shadow that drifts against the tilt */}
        <motion.div
          aria-hidden
          className="absolute inset-x-6 bottom-0 top-6 rounded-[28px] bg-indigo-950/40 blur-2xl"
          style={{ x: shadowX, y: shadowY }}
        />

        <motion.button
          type="button"
          onClick={toggleFlip}
          aria-pressed={flipped}
          aria-label={`${data.campaignName || L.untitled} — ${flipLabel}`}
          className="relative block aspect-[1.22/1] w-full min-[400px]:aspect-[1.4/1] sm:aspect-[1.62/1] cursor-pointer rounded-[24px] text-left transform-3d focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300"
          style={{ rotateX: reduceMotion ? 0 : tiltX, rotateY }}
        >
          {/* FRONT */}
          <div
            className={`absolute inset-0 overflow-hidden rounded-[24px] bg-gradient-to-br from-[#1f1846] via-[#2e2675] to-[#4b3fa8] text-white shadow-[0_24px_48px_-16px_rgba(30,27,75,0.55),0_2px_6px_rgba(30,27,75,0.25)] backface-hidden ${inactive ? 'grayscale-[0.85]' : ''}`}
            style={NOTCH_STYLE}
          >
            <div aria-hidden className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-amber-300/15 blur-2xl" />
            <div aria-hidden className="absolute -bottom-20 left-10 h-44 w-44 rounded-full bg-fuchsia-300/10 blur-2xl" />
            <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.035)_0_2px,transparent_2px_14px)]" />

            <div className="relative flex h-full">
              {/* Main area */}
              <div className="flex min-w-0 flex-1 flex-col justify-between p-[6%]">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/90 sm:tracking-[0.32em]">{brandName}</span>
                  {data.isTemplate ? (
                    <span className="whitespace-nowrap rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-indigo-950">{L.template}</span>
                  ) : (
                    <span className="whitespace-nowrap rounded-full border border-white/25 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/80 sm:tracking-[0.2em]">{L.eVoucher}</span>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="line-clamp-2 text-[12px] font-medium leading-snug text-white/85 sm:text-[13px]">{data.campaignName || L.untitled}</p>
                  <p className="mt-0.5 bg-gradient-to-r from-amber-100 via-amber-300 to-amber-100 bg-clip-text text-[clamp(26px,9vw,40px)] font-bold uppercase leading-none tracking-tight text-transparent">
                    {benefitLabel}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-white/60">{L.complimentary}</p>
                </div>

                {/* Code gets its own full line: it is what staff read back to the customer */}
                <div className="space-y-1.5 text-[10px] leading-tight">
                  <div>
                    <p className="uppercase tracking-wider text-white/50">{L.voucherCode}</p>
                    <p className="whitespace-nowrap font-mono text-[clamp(12px,3.6vw,15px)] font-semibold tracking-[0.06em] sm:tracking-[0.12em]">{code}</p>
                  </div>
                  <p className="text-white/60">
                    {L.validUntil} <span className="font-semibold text-white">{data.validUntil ? formatPromoDate(data.validUntil) : '—'}</span>
                  </p>
                </div>
              </div>

              {/* Perforation */}
              <div aria-hidden className="my-4 border-l-2 border-dashed border-white/25" />

              {/* Stub */}
              <div className="flex shrink-0 flex-col items-center justify-between py-[6%] pr-[4%] pl-[3%]" style={{ width: `${STUB_RATIO * 100}%` }}>
                <span className="text-center text-[9px] font-semibold uppercase leading-tight tracking-wider text-white/70">
                  {data.isTemplate ? L.forCustomer : (data.customerName ?? '')}
                </span>
                <span className="flex w-full items-center justify-center rounded-xl bg-white p-1.5 shadow-inner" style={{ maxWidth: STUB_QR_SIZE + 12 }}>
                  {data.qrPayload && !inactive ? (
                    <QRCodeSVG value={data.qrPayload} size={STUB_QR_SIZE} marginSize={0} level="M" className="h-auto w-full" />
                  ) : (
                    <QrCode size={STUB_QR_SIZE * 0.75} className="h-auto w-3/4 text-indigo-900/70" aria-hidden />
                  )}
                </span>
                <span className="text-center text-[9px] leading-tight text-white/70">{L.usage(data.usage)}</span>
              </div>
            </div>

            {/* Status stamp / template ribbon */}
            {inactive && data.status && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-4 border-rose-300/90 px-4 py-1 text-xl font-black uppercase tracking-widest text-rose-200/95">
                {L.status[data.status]}
              </span>
            )}

            {!reduceMotion && <motion.div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: glare }} />}
          </div>

          {/* BACK */}
          <div className="absolute inset-0 flex items-center gap-[5%] overflow-hidden rounded-[24px] border border-indigo-100 bg-gradient-to-br from-white to-indigo-50 p-[6%] text-indigo-950 shadow-[0_24px_48px_-16px_rgba(30,27,75,0.45)] backface-hidden rotate-y-180">
            <span className="flex w-[42%] shrink-0 items-center justify-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-indigo-100">
              {data.qrPayload && !inactive ? (
                <QRCodeSVG value={data.qrPayload} size={BACK_QR_SIZE} marginSize={1} level="M" className="h-auto w-full" />
              ) : (
                <span className="flex aspect-square w-full flex-col items-center justify-center gap-2 text-center text-[11px] text-indigo-900/60">
                  <QrCode size={48} aria-hidden />
                  {data.isTemplate ? L.qrOnIssue : L.qrUnavailable}
                </span>
              )}
            </span>
            <div className="min-w-0 space-y-2">
              <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-500 sm:tracking-[0.28em]">{brandName}</p>
              <p className="whitespace-nowrap font-mono text-[clamp(12px,3.4vw,14px)] font-bold tracking-[0.04em] sm:tracking-[0.12em]">{code}</p>
              <p className="text-[12px] leading-snug text-indigo-900/70">{L.qrInstruction}</p>
              {data.status && <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">{L.status[data.status]}</p>}
            </div>
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
