import { getEmailConfig } from '@/lib/email-config';
import { getBrownLogoPng, getOriginalLogoPng } from '@/lib/promotion-email-card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /voucher/logo[?tone=original] — brand logo for the customer page and the e-voucher email.
// Default: re-coloured brown (cream backgrounds). tone=original: the stored cream logo (dark mode).
// Public on purpose (the logo is public); outside /api so no session is involved.
export async function GET(request: Request) {
    const cfg = await getEmailConfig();
    const original = new URL(request.url).searchParams.get('tone') === 'original';
    const logo = cfg.email_logo_url ? await (original ? getOriginalLogoPng : getBrownLogoPng)(cfg.email_logo_url) : null;
    if (!logo) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(logo), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
}
