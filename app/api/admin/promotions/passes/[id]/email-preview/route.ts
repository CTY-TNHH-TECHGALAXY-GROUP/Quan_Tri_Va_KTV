import { PromotionEmailService } from '@/lib/services/PromotionEmailService';
import { authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/promotions/passes/:id/email-preview?lang=en|vi|cn|jp|kr
// Exact e-voucher email the owner would receive (sender, reply-to, subject, HTML). Sends nothing.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('pass.issue');
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });
        const lang = new URL(request.url).searchParams.get('lang');
        return promotionJson(await PromotionEmailService.previewPassEmail(id, lang));
    } catch (e) {
        return promotionInternalError(e);
    }
}
