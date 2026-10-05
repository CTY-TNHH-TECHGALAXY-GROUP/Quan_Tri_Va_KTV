import 'server-only';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import type { PromotionPublicVoucherDto } from '@/lib/types/promotion';

const MAX_TOKEN_LENGTH = 200;

/** Public voucher data for the image routes (same token + data as the /voucher page). */
export async function publicVoucherFor(request: Request): Promise<{ token: string; voucher: PromotionPublicVoucherDto } | null> {
    const token = new URL(request.url).searchParams.get('t')?.trim() ?? '';
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const res = await PromotionEngineService.getPublicVoucher(token);
    return res.success ? { token, voucher: res.data } : null;
}

/** Images change only when the voucher changes; email clients / proxies fetch once. */
export const pngResponse = (buf: Buffer) =>
    new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });

export const notFound = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
