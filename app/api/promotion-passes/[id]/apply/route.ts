import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { ApplyPromotionPassSchema } from '@/lib/schemas/promotion.schema';
import {
    PROMOTION_COUNTER_PERMISSION, authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/promotion-passes/:id/apply  { bookingId, overrideConditions?, overrideNote? }
// Order missing the apply conditions → 422 ORDER_CONDITION_NOT_MET with error.data.unmetReasons (for the popup).
// Counter confirms → resend with overrideConditions: true + overrideNote (mandatory, 3–500 chars).
// Expired / used up / already applied / order closed are never overridable.
// Server re-validates everything (pass, campaign, time, order owner/status, per-order limit).
// staffId comes from the session, never from the body.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion(PROMOTION_COUNTER_PERMISSION);
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, ApplyPromotionPassSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });
        return promotionJson(await PromotionEngineService.applyPassToOrder(id, body.data.bookingId, auth.staffId, {
            conditions: body.data.overrideConditions, note: body.data.overrideNote ?? null,
        }), 201);
    } catch (e) {
        return promotionInternalError(e);
    }
}
