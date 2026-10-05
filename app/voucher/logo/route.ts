import { getEmailConfig } from '@/lib/email-config';
import { getBrownLogoPng } from '@/lib/promotion-email-card';

export const runtime = 'nodejs';
export const revalidate = 3600;

// GET /voucher/logo — the brand logo re-coloured brown for the cream customer page.
// Public on purpose (the logo is public); outside /api so no session is involved.
export async function GET() {
    const cfg = await getEmailConfig();
    const logo = cfg.email_logo_url ? await getBrownLogoPng(cfg.email_logo_url) : null;
    if (!logo) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(logo), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
}
