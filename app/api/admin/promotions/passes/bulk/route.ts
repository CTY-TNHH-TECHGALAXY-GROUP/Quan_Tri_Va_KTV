import { z } from 'zod';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PromotionEmailService } from '@/lib/services/PromotionEmailService';
import { PROMOTION_BULK_ISSUE_MAX } from '@/lib/constants/promotion';
import type { PromotionBulkIssueItemDto, PromotionBulkIssueResultDto } from '@/lib/types/promotion';
import { authorizePromotion, parsePromotionBody, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';
// Emails are sent inside a 40 s budget; the rest stay PENDING for the cron.
export const maxDuration = 60;

const EMAIL_BUDGET_MS = 40_000;
const EMAIL_CONCURRENCY = 5;

const BodySchema = z.object({
    campaignId: z.string().uuid(),
    customerIds: z.array(z.string().trim().min(1)).min(1).max(PROMOTION_BULK_ISSUE_MAX),
}).strict();

/**
 * POST /api/admin/promotions/passes/bulk  { campaignId, customerIds[] (≤ 50) }
 * Admin ticks several customer profiles and issues the e-voucher to all of them.
 * Per-customer result; one failure never blocks the others. Already-issued customers are
 * reported ALREADY_EXISTS (no duplicate, no re-send).
 */
export async function POST(request: Request) {
    const auth = await authorizePromotion('pass.issue');
    if (auth instanceof Response) return auth;
    const body = await parsePromotionBody(request, BodySchema);
    if (body instanceof Response) return body;
    try {
        const issued = await PromotionEngineService.issueBulk(body.data.campaignId, body.data.customerIds, auth.staffId);
        if (!issued.success) return promotionJson(issued);

        const toMail = issued.data.results
            .filter(r => r.status === 'ISSUED' && r.passId && r.emailStatus === 'PENDING')
            .map(r => r.passId!);
        const deliveries = await PromotionEmailService.sendMany(toMail, { concurrency: EMAIL_CONCURRENCY, budgetMs: EMAIL_BUDGET_MS });

        const results: PromotionBulkIssueItemDto[] = issued.data.results.map(r => ({
            customerId: r.customerId,
            status: r.status,
            passId: r.passId,
            voucherCode: r.voucherCode,
            reissued: r.reissued,
            errorCode: r.errorCode,
            emailDelivery: r.status !== 'ISSUED' ? undefined
                : r.passId && deliveries.has(r.passId) ? deliveries.get(r.passId)
                : { status: 'SKIPPED', reason: r.emailStatus === 'SKIPPED' ? 'CUSTOMER_NO_EMAIL' : r.emailStatus },
        }));
        const count = (pred: (r: PromotionBulkIssueItemDto) => boolean) => results.filter(pred).length;
        const data: PromotionBulkIssueResultDto = {
            results,
            summary: {
                issued: count(r => r.status === 'ISSUED'),
                alreadyExists: count(r => r.status === 'ALREADY_EXISTS'),
                failed: count(r => r.status === 'FAILED'),
                emailSent: count(r => r.emailDelivery?.status === 'SENT'),
                emailFailed: count(r => r.emailDelivery?.status === 'FAILED'),
                emailSkipped: count(r => r.emailDelivery?.status === 'SKIPPED'),
                emailQueued: count(r => r.emailDelivery?.status === 'QUEUED'),
            },
        };
        return promotionJson({ success: true, data }, 201);
    } catch (e) {
        return promotionInternalError(e);
    }
}
