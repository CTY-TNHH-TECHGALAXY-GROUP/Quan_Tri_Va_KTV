import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PromotionPassStatusSchema } from '@/lib/schemas/promotion.schema';
import {
    PROMOTION_ADMIN_PERMISSION, authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/promotions/passes/:id — pass + qrPayload
export async function GET(_request: Request, { params }: Ctx) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return notFound();
        return promotionJson(await PromotionEngineService.getPass(id));
    } catch (e) {
        return promotionInternalError(e);
    }
}

// PATCH /api/admin/promotions/passes/:id  { action: SUSPEND | REACTIVATE | CANCEL, reason? }
export async function PATCH(request: Request, { params }: Ctx) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, PromotionPassStatusSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return notFound();
        return promotionJson(await PromotionEngineService.setPassStatus(id, body.data.action, body.data.reason ?? null, auth.staffId));
    } catch (e) {
        return promotionInternalError(e);
    }
}
