import { NextResponse } from 'next/server';
import { PromotionEngineService, maskPassPii } from '@/lib/services/PromotionEngineService';
import { ApplyPromotionPassSchema } from '@/lib/schemas/promotion.schema';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/promotion-passes/:id/apply  { bookingId, overrideConditions?, overrideNote? }
// Order missing the apply conditions → 422 ORDER_CONDITION_NOT_MET with error.data.unmetReasons (for the popup).
// Counter confirms → resend with overrideConditions: true + overrideNote (mandatory, 3–500 chars).
// Expired / used up / already applied / order closed are never overridable.
// Server re-validates everything (pass, campaign, time, order owner/status, per-order limit).
// staffId comes from the session, never from the body.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion('scan.apply');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, ApplyPromotionPassSchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });
        // Overriding the apply conditions is its own permission (Roles page: "KM: Áp ngoại lệ").
        if (body.data.overrideConditions && !auth.can('apply.override')) {
            return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Bạn không có quyền áp ngoại lệ cho đơn chưa đủ điều kiện' } }, { status: 403 });
        }
        const res = await PromotionEngineService.applyPassToOrder(id, body.data.bookingId, auth.staffId, {
            conditions: body.data.overrideConditions, note: body.data.overrideNote ?? null,
        });
        if (!res.success && res.error.code === 'ORDER_CONDITION_NOT_MET' && res.error.data && typeof res.error.data === 'object') {
            res.error.data = { ...(res.error.data as object), canOverride: auth.can('apply.override') };
        }
        if (res.success && !auth.can('customer.pii')) res.data = { ...res.data, pass: maskPassPii(res.data.pass) };
        return promotionJson(res, 201);
    } catch (e) {
        return promotionInternalError(e);
    }
}
