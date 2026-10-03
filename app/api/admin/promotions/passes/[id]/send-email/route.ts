import { z } from 'zod';
import { PromotionEmailService } from '@/lib/services/PromotionEmailService';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import {
    PROMOTION_ADMIN_PERMISSION, authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BodySchema = z.object({ kind: z.enum(['ISSUE', 'REMINDER']).optional() }).strict();

// POST /api/admin/promotions/passes/:id/send-email  { kind? }
// (Re)sends the e-voucher to the email CURRENTLY on the owner's customer profile. No custom recipient.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, BodySchema);
    if (body instanceof Response) return body;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Không tìm thấy voucher' } });
        const delivery = await PromotionEmailService.sendPassEmail(id, { force: true, kind: body.data.kind ?? 'ISSUE' });
        if (!delivery.success) return promotionJson(delivery);
        if (delivery.data.status === 'FAILED') {
            return promotionJson({ success: false, error: { code: 'EMAIL_SEND_FAILED', message: 'Gửi email thất bại', data: delivery.data } });
        }
        const pass = await PromotionEngineService.getPass(id);
        return promotionJson({ success: true, data: { ...(pass.success ? pass.data : {}), emailDelivery: delivery.data } });
    } catch (e) {
        return promotionInternalError(e);
    }
}
