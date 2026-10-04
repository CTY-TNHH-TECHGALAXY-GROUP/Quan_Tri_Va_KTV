import React from 'react';
import { ORIA } from './voucher.theme';

/**
 * Hand-drawn-style ornaments for the Oria Spa e-voucher (decorative, aria-hidden).
 * Pure SVG so they stay crisp at any card size and add no image requests.
 */

type OrnamentProps = { className?: string; style?: React.CSSProperties };

const LEAF = 'M0 0 C5 -6.5 14 -6.5 19 0 C14 6.5 5 6.5 0 0 Z';

type LeafSpec = { x: number; y: number; r: number; s?: number; tone?: 0 | 1 | 2 };

const Leaves = ({ leaves }: { leaves: LeafSpec[] }) => (
  <>
    {leaves.map((l, i) => {
      const fill = [ORIA.leaf, ORIA.leafDark, ORIA.leafLight][l.tone ?? (i % 3 === 0 ? 1 : 0)];
      return (
        <g key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.r}) scale(${l.s ?? 1})`}>
          <path d={LEAF} fill={fill} />
          <path d="M1 0 L17 0" stroke="#1E2A0C" strokeOpacity="0.45" strokeWidth="0.8" />
        </g>
      );
    })}
  </>
);

/** A curved branch of leaves. */
export const Sprig = ({ className = '', style }: OrnamentProps) => (
  <svg viewBox="0 0 140 70" className={className} style={style} aria-hidden>
    <path d="M4 62 C40 48 80 30 136 8" stroke="#3A2A12" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <Leaves
      leaves={[
        { x: 18, y: 56, r: -70 }, { x: 22, y: 54, r: 25, tone: 2 },
        { x: 42, y: 46, r: -75 }, { x: 46, y: 44, r: 20 },
        { x: 66, y: 36, r: -80, tone: 1 }, { x: 70, y: 34, r: 15, tone: 2 },
        { x: 90, y: 26, r: -85 }, { x: 94, y: 24, r: 10, tone: 1 },
        { x: 112, y: 17, r: -90, s: 0.85 }, { x: 116, y: 15, r: 5, s: 0.85 },
        { x: 130, y: 10, r: -20, s: 0.7, tone: 2 },
      ]}
    />
  </svg>
);

/** Herbal compress, oil bottle with a flower label, stacked hot stones. */
export const SpaStill = ({ className = '', style }: OrnamentProps) => (
  <svg viewBox="0 0 170 112" className={className} style={style} aria-hidden>
    {/* ground shadow */}
    <ellipse cx="88" cy="106" rx="80" ry="5" fill="#5A2A0C" opacity="0.35" />
    {/* herbal compress */}
    <g>
      <circle cx="38" cy="80" r="25" fill="#B39573" stroke="#3A2412" strokeWidth="1.5" />
      <path d="M18 72 C30 66 46 66 58 72 M16 84 C30 90 46 90 60 84 M24 96 C34 100 44 100 52 96" stroke="#7A5C3C" strokeWidth="1.2" fill="none" />
      <path d="M30 56 C26 44 30 36 38 32 C46 36 50 44 46 56 Z" fill="#9C7D5A" stroke="#3A2412" strokeWidth="1.3" />
      <rect x="29" y="53" width="18" height="5" rx="2" fill="#4A2E16" />
      <path d="M38 32 C36 26 40 22 44 24" stroke="#4A2E16" strokeWidth="1.4" fill="none" />
    </g>
    {/* oil bottle */}
    <g>
      <rect x="73" y="44" width="30" height="60" rx="7" fill={ORIA.amberDark} stroke="#2A140A" strokeWidth="1.5" />
      <rect x="78" y="48" width="4" height="48" rx="2" fill="#F2A33A" opacity="0.35" />
      <rect x="82" y="34" width="12" height="11" rx="2" fill="#2A1A10" />
      <path d="M85 34 V24 H100 V28" stroke="#2A1A10" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M100 30 q1.5 4 0 6" stroke="#F7D9A6" strokeWidth="1.4" fill="none" />
      <rect x="77" y="62" width="22" height="26" rx="3" fill="#E9A24A" stroke="#2A140A" strokeWidth="1" />
      <g transform="translate(88 75)" fill={ORIA.flower} stroke="#7A3A10" strokeWidth="0.6">
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="0" cy="-5" rx="2.4" ry="5" transform={`rotate(${a})`} />
        ))}
        <circle r="1.8" fill="#7A3A10" />
      </g>
    </g>
    {/* hot stones */}
    <g stroke="#4A4440" strokeWidth="1.2">
      <ellipse cx="140" cy="96" rx="27" ry="10" fill="#1C1917" />
      <ellipse cx="140" cy="83" rx="22" ry="8.5" fill="#24201D" />
      <ellipse cx="140" cy="71" rx="16" ry="7" fill="#1C1917" />
      <path d="M128 69 q8 -4 18 0" stroke="#6B625B" fill="none" />
    </g>
    <Leaves leaves={[{ x: 60, y: 100, r: -150, s: 0.8 }, { x: 108, y: 102, r: -30, s: 0.8, tone: 2 }, { x: 112, y: 98, r: -60, s: 0.7 }]} />
  </svg>
);

/** Cinnamon sticks with a star anise (bottom-left corner). */
export const Cinnamon = ({ className = '', style }: OrnamentProps) => (
  <svg viewBox="0 0 90 70" className={className} style={style} aria-hidden>
    {[0, 9, 18].map((d) => (
      <g key={d} transform={`translate(${6 + d} ${18 + d / 2}) rotate(28)`}>
        <rect width="66" height="9" rx="4" fill="#8A4A1E" stroke="#3A1E0C" strokeWidth="1.1" />
        <ellipse cx="66" cy="4.5" rx="3" ry="4.5" fill="#5A2E12" stroke="#3A1E0C" strokeWidth="0.8" />
        <path d="M6 3 H58" stroke="#B4703A" strokeWidth="0.9" />
      </g>
    ))}
    <g transform="translate(18 54)" fill="#6B3410" stroke="#2A140A" strokeWidth="0.8">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M0 0 L2.4 -9 L0 -11 L-2.4 -9 Z" transform={`rotate(${a})`} />
      ))}
      <circle r="2" fill="#3A1E0C" />
    </g>
  </svg>
);

/** Mortar & pestle with ginger (stub corner). */
export const Mortar = ({ className = '', style }: OrnamentProps) => (
  <svg viewBox="0 0 80 60" className={className} style={style} aria-hidden>
    <path d="M44 6 L58 34" stroke="#C99A5A" strokeWidth="7" strokeLinecap="round" />
    <path d="M44 6 L58 34" stroke="#3A2412" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
    <path d="M24 32 H72 C72 48 62 56 48 56 C34 56 24 48 24 32 Z" fill="#B88A4E" stroke="#3A2412" strokeWidth="1.4" />
    <ellipse cx="48" cy="32" rx="24" ry="5" fill="#8A6234" stroke="#3A2412" strokeWidth="1.2" />
    <path d="M4 54 C10 46 18 48 20 54 C22 50 28 50 28 56 Z" fill="#D9A55A" stroke="#6B3E14" strokeWidth="1" />
    <Leaves leaves={[{ x: 8, y: 40, r: -110, s: 0.8 }, { x: 12, y: 38, r: -40, s: 0.75, tone: 2 }]} />
  </svg>
);
