import { NextRequest } from 'next/server';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PROMOTION_USAGE_STATUSES } from '@/lib/constants/promotion';
import { PROMOTION_ADMIN_PERMISSION, authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/promotions/usages?from=yyyy-MM-dd&to=yyyy-MM-dd&campaignId&status&q&passId&overridden=1|0
// from / to are VN calendar dates (inclusive). Max 500 rows, newest first.
export async function GET(request: NextRequest) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const sp = request.nextUrl.searchParams;
        const date = (k: string) => { const v = sp.get(k); return v && DATE_RE.test(v) ? v : null; };
        const uuid = (k: string) => { const v = sp.get(k); return v && UUID_RE.test(v) ? v : null; };
        const status = sp.get('status');
        return promotionJson(await PromotionEngineService.listUsages({
            from: date('from'), to: date('to'), campaignId: uuid('campaignId'), passId: uuid('passId'),
            status: status && (PROMOTION_USAGE_STATUSES as readonly string[]).includes(status) ? status : null,
            q: sp.get('q'),
            overridden: sp.has('overridden') ? sp.get('overridden') === '1' || sp.get('overridden') === 'true' : null,
        }));
    } catch (e) {
        return promotionInternalError(e);
    }
}
