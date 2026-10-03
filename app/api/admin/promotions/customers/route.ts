import { NextRequest } from 'next/server';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PROMOTION_ADMIN_PERMISSION, authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/admin/promotions/customers?q= — light customer picker for manual issue.
// [{ id, name, phone, email, language }], q ≥ 2 chars, max 20.
export async function GET(request: NextRequest) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const q = (request.nextUrl.searchParams.get('q') || '').slice(0, 100);
        return promotionJson(await PromotionEngineService.searchCustomers(q));
    } catch (e) {
        return promotionInternalError(e);
    }
}
