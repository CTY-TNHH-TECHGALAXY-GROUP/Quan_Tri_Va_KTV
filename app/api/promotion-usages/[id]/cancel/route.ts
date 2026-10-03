import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { CancelPromotionUsageSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/promotion-usages/:id/cancel  { reason? }
// Free-minutes usage can only be cancelled while its KM item is not dispatched yet.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('scan.apply');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, CancelPromotionUsageSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'USAGE_NOT_FOUND', message: 'Không tìm thấy lượt áp dụng' } });
        return promotionJson(await PromotionEngineService.cancelUsage(id, auth.staffId, body.data.reason ?? null));
    } catch (e) {
        return promotionInternalError(e);
    }
}
