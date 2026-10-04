import type React from 'react';

/**
 * Oria Spa e-voucher theme — inspired by the hand-painted shop sign:
 * amber / burnt-orange painted board, dark-brown brush lettering,
 * botanical sprigs, and a dark-brown footer band with orange text.
 */
export const ORIA = {
  ink: '#2B1A0E',
  inkSoft: '#4A2C14',
  cream: '#FFF4E0',
  creamText: '#F7D9A6',
  band: '#24160D',
  bandText: '#F4A64A',
  leaf: '#4D5B22',
  leafDark: '#2E3913',
  leafLight: '#7C8B35',
  amberDark: '#6B3410',
  flower: '#F4B34A',
} as const;

/** Fine paint grain (SVG turbulence), multiplied over the colour layers. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.42  0 0 0 0 0.2  0 0 0 0 0.05  0 0 0 0.32 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** Painted amber board with burnt edges (front of the card). */
export const FRONT_BOARD: React.CSSProperties = {
  // Saturated amber like the painted board; light patch top-left, darker burnt corners.
  backgroundColor: '#EC8A1E',
  backgroundImage: [
    GRAIN,
    'radial-gradient(85% 70% at 34% 40%, rgba(255,196,74,0.85) 0%, rgba(255,184,64,0.35) 45%, rgba(255,184,64,0) 70%)',
    'radial-gradient(55% 50% at 78% 22%, rgba(255,178,58,0.6) 0%, rgba(255,178,58,0) 70%)',
    'repeating-linear-gradient(-7deg, rgba(150,60,10,0.09) 0 3px, transparent 3px 12px)',
    'linear-gradient(118deg, rgba(196,78,14,0.45) 0%, rgba(196,78,14,0) 38%, rgba(150,52,10,0.45) 100%)',
  ].join(','),
  boxShadow: 'inset 0 0 0 1px rgba(90,36,8,0.35), inset 0 0 56px 10px rgba(110,40,8,0.62)',
};

/** Warm parchment with an amber burnt edge (back of the card). */
export const BACK_PAPER: React.CSSProperties = {
  backgroundColor: '#FFF1D6',
  backgroundImage: [GRAIN, 'radial-gradient(100% 90% at 50% 45%, rgba(255,248,232,1) 0%, rgba(255,240,210,0.6) 60%, rgba(240,170,80,0.45) 100%)'].join(','),
  boxShadow: 'inset 0 0 0 1px rgba(90,40,10,0.2), inset 0 0 36px 4px rgba(214,128,46,0.45)',
};
