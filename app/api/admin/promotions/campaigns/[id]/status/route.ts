import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PromotionCampaignStatusSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// POST /api/admin/promotions/campaigns/:id/status  { action: ACTIVATE | DEACTIVATE | END }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, PromotionCampaignStatusSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.setCampaignStatus(id, body.data.action, auth.staffId));
    } catch (e) {
        return promotionInternalError(e);
    }
}
