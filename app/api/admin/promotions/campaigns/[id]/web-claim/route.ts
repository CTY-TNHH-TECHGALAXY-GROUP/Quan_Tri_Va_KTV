import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { WebClaimConfigSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const CLAIM_STATUSES = new Set(['RESERVED', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED']);

const maskPhone = (phone: string | null) => (phone ? `${'•'.repeat(Math.max(phone.length - 3, 0))}${phone.slice(-3)}` : null);

// GET /api/admin/promotions/campaigns/:id/web-claim?status=  → { stats, claims }
// Phone / name of the voucher holder need `customer.pii` (same rule as the scan screen).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('campaign.read');
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        const raw = new URL(request.url).searchParams.get('status');
        const result = await PromotionEngineService.getWebClaimOverview(id, raw && CLAIM_STATUSES.has(raw) ? raw : null);
        if (result.success && !auth.can('customer.pii')) {
            result.data.claims = result.data.claims.map((c) => ({ ...c, phone: maskPhone(c.phone), customerName: null }));
        }
        return promotionJson(result);
    } catch (e) {
        return promotionInternalError(e);
    }
}

// PATCH /api/admin/promotions/campaigns/:id/web-claim  { totalQuantity, reservationMinutes, maxOpenPerPhone, maxTotalPerPhone, publicSlug }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, WebClaimConfigSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        return promotionJson(await PromotionEngineService.configureWebClaim(id, body.data, auth.staffId));
    } catch (e) {
        return promotionInternalError(e);
    }
}
