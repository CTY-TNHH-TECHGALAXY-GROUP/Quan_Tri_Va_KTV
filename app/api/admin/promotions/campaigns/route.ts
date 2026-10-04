import { NextRequest } from 'next/server';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { CreatePromotionCampaignSchema } from '@/lib/schemas/promotion.schema';
import { PROMOTION_CAMPAIGN_STATUSES } from '@/lib/constants/promotion';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/admin/promotions/campaigns?status=ACTIVE
export async function GET(request: NextRequest) {
    const auth = await authorizePromotion('campaign.read');
    if (auth instanceof Response) return auth;
    try {
        const status = request.nextUrl.searchParams.get('status');
        const valid = status && (PROMOTION_CAMPAIGN_STATUSES as readonly string[]).includes(status) ? status : undefined;
        return promotionJson(await PromotionEngineService.listCampaigns(valid));
    } catch (e) {
        return promotionInternalError(e);
    }
}

// POST /api/admin/promotions/campaigns — creates a DRAFT campaign + its KM#### service
export async function POST(request: Request) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, CreatePromotionCampaignSchema);
    if (body instanceof Response) return body;
    try {
        return promotionJson(await PromotionEngineService.createCampaign(body.data, auth.staffId), 201);
    } catch (e) {
        return promotionInternalError(e);
    }
}
