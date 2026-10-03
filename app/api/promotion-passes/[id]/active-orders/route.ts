import { NextRequest } from 'next/server';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import {
    PROMOTION_COUNTER_PERMISSION, authorizePromotion, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/promotion-passes/:id/active-orders?q=
// Open orders (NEW / PREPARING / IN_PROGRESS) of the WHOLE spa in the current business day.
// Voucher owner's orders first. Each row carries the server verdict canApply + blockedReasonCode.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion(PROMOTION_COUNTER_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });
        const q = (request.nextUrl.searchParams.get('q') || '').slice(0, 100) || null;
        return promotionJson(await PromotionEngineService.getOrderCandidates(id, q));
    } catch (e) {
        return promotionInternalError(e);
    }
}
