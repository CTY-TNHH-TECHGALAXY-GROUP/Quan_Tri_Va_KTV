import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { UpdatePromotionCampaignSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/promotions/campaigns/:id
export async function GET(_request: Request, { params }: Ctx) {
    const auth = await authorizePromotion('campaign.read');
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.getCampaign(id));
    } catch (e) {
        return promotionInternalError(e);
    }
}

// PATCH /api/admin/promotions/campaigns/:id — rule fields only while DRAFT
export async function PATCH(request: Request, { params }: Ctx) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, UpdatePromotionCampaignSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.updateCampaign(id, body.data, auth.staffId));
    } catch (e) {
        return promotionInternalError(e);
    }
}
