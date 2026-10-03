import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/admin/promotions/overview — { activeCampaigns, passesIssued, activePasses, usesThisMonth }
export async function GET() {
    const auth = await authorizePromotion('pass.view');
    if (auth instanceof Response) return auth;
    try {
        return promotionJson(await PromotionEngineService.getOverview());
    } catch (e) {
        return promotionInternalError(e);
    }
}
