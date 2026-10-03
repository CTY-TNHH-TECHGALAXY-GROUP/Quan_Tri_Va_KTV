import { NextRequest } from 'next/server';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PromotionEmailService } from '@/lib/services/PromotionEmailService';
import { IssuePromotionPassSchema } from '@/lib/schemas/promotion.schema';
import { PROMOTION_EXPIRY_FILTERS, PROMOTION_PASS_EFFECTIVE_STATUSES, PROMOTION_PASS_GROUPS } from '@/lib/constants/promotion';
import {
    PROMOTION_ADMIN_PERMISSION, authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const pick = <T extends readonly string[]>(v: string | null, allowed: T) =>
    v && (allowed as readonly string[]).includes(v) ? v : null;

// GET /api/admin/promotions/passes?q&campaignId&status&expiry&group&limit&offset
// q: customer name / phone / email / voucher code. status = effective status. No qrPayload in rows.
// group=ACTIVE (usable / re-openable, soonest expiry first) | PAST (expired / used up / cancelled, latest end first).
export async function GET(request: NextRequest) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const sp = request.nextUrl.searchParams;
        const res = await PromotionEngineService.searchPasses({
            q: sp.get('q'),
            campaignId: sp.get('campaignId') || null,
            status: pick(sp.get('status'), PROMOTION_PASS_EFFECTIVE_STATUSES),
            expiry: pick(sp.get('expiry'), PROMOTION_EXPIRY_FILTERS),
            group: pick(sp.get('group')?.toUpperCase() ?? null, PROMOTION_PASS_GROUPS),
            limit: Number(sp.get('limit')) || 100,
            offset: Number(sp.get('offset')) || 0,
        });
        // Contract: data = Pass[]; total in `meta`.
        if (!res.success) return promotionJson(res);
        return Response.json({ success: true, data: res.data.items, meta: { total: res.data.total } });
    } catch (e) {
        return promotionInternalError(e);
    }
}

// POST /api/admin/promotions/passes  { campaignId, customerId, sendEmail? }
// Manual issue to the selected customer profile; e-voucher is emailed to that profile's email.
// 201 created | 409 PASS_ALREADY_EXISTS (existing pass in error.data)
export async function POST(request: Request) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, IssuePromotionPassSchema);
    if (body instanceof Response) return body;
    try {
        const { campaignId, customerId, sendEmail } = body.data;
        const issued = await PromotionEngineService.issueManual(campaignId, customerId, auth.staffId);
        if (!issued.success) return promotionJson(issued);
        if (sendEmail === false) return promotionJson(issued, 201);

        const delivery = await PromotionEmailService.sendPassEmail(issued.data.id);
        const fresh = await PromotionEngineService.getPass(issued.data.id);
        const pass = fresh.success ? fresh.data : issued.data;
        return Response.json({
            success: true,
            data: { ...pass, emailDelivery: delivery.success ? delivery.data : { status: 'SKIPPED', reason: delivery.error.code } },
        }, { status: 201 });
    } catch (e) {
        return promotionInternalError(e);
    }
}
