import { buildPromotionQrPng } from '@/lib/promotion-email';
import { notFound, pngResponse, publicVoucherFor } from '../voucher-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /voucher/qr?t=<token> — large QR for the counter, linked from the email (no attachment).
// Only while the voucher is usable (same rule as the /voucher page).
export async function GET(request: Request) {
    try {
        const found = await publicVoucherFor(request);
        if (!found?.voucher.qrPayload) return notFound();
        return pngResponse(await buildPromotionQrPng(found.voucher.qrPayload));
    } catch (e) {
        console.error('[voucher/qr]', (e as Error)?.message);
        return notFound();
    }
}
