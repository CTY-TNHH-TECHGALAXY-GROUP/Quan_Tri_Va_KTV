import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { WebClaimPauseSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// POST /api/admin/promotions/campaigns/:id/web-claim/pause  { paused }
// Paused = no new saves on Web Booking; reserved vouchers still activate.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, WebClaimPauseSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.setWebClaimPaused(id, body.data.paused, auth.staffId));
    } catch (e) {
        return promotionInternalError(e);
    }
}
