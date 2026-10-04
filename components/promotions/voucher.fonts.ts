import { Mansalva } from 'next/font/google';

/**
 * Hand-painted brush lettering, close to the Oria Spa shop sign.
 * Mansalva ships a Vietnamese subset, so "+30 PHÚT" keeps its accents.
 */
export const voucherBrush = Mansalva({ weight: '400', subsets: ['latin', 'vietnamese'], display: 'swap' });
