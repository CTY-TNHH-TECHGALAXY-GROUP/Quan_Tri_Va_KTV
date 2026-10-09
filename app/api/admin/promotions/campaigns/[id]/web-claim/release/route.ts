import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { WebClaimReleaseSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// POST /api/admin/promotions/campaigns/:id/web-claim/release  { claimId?, reason }
// Only RESERVED vouchers; no claimId = every reservation of the campaign (bot drain).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, WebClaimReleaseSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.releaseWebClaims(id, body.data.claimId ?? null, body.data.reason, auth.staffId));
    } catch (e) {
        return promotionInternalError(e);
    }
}
