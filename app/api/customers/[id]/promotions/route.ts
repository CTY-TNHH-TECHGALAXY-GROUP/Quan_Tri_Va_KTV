import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import {
    PROMOTION_COUNTER_PERMISSION, authorizePromotion, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/customers/:id/promotions — { active, past, usages }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion(PROMOTION_COUNTER_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.getCustomerPromotions(decodeURIComponent(id)));
    } catch (e) {
        return promotionInternalError(e);
    }
}
