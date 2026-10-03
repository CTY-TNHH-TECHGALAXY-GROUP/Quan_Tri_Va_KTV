import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PROMOTION_ADMIN_PERMISSION, authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/admin/promotions/overview — { activeCampaigns, passesIssued, activePasses, usesThisMonth }
export async function GET() {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        return promotionJson(await PromotionEngineService.getOverview());
    } catch (e) {
        return promotionInternalError(e);
    }
}
