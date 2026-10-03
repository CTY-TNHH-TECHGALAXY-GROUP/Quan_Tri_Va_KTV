import { NextRequest } from 'next/server';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import {
    PROMOTION_CUSTOMER_TIERS, PROMOTION_GENDERS, PROMOTION_GUEST_TYPES,
} from '@/lib/constants/promotion';
import { PROMOTION_ADMIN_PERMISSION, authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANGS = ['vi', 'en', 'cn', 'jp', 'kr'];

const invalid = (field: string, message: string) =>
    promotionJson({ success: false, error: { code: 'VALIDATION_ERROR', message, data: { field } } });

/**
 * GET /api/admin/promotions/campaigns/:id/customer-candidates
 *   ?q&onlyQualified&qualifiedFrom&qualifiedTo&visitFrom&visitTo&minVisits&minSpent
 *   &tier(NEW|RETURNING)&vipMenu(USED|NOT_USED)&guestType(SINGLE|GROUP)&gender&nationality&language
 *   &hasEmail(1|0, default 1)&limit(<=50)&offset
 * → { rows, total, limit, offset, excludedNoEmail, nationalities, qualificationIgnored, qualifyingComputed }
 * Metrics come from promo_customer_stats (visits = completed parent bookings). PII → `promotions` only.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        const { id } = await params;
        if (!UUID_RE.test(id)) return promotionJson({ success: false, error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Không tìm thấy chương trình' } });
        const sp = request.nextUrl.searchParams;
        const filter: Record<string, unknown> = {};

        const q = sp.get('q')?.trim();
        if (q) filter.q = q.slice(0, 100);
        for (const k of ['qualifiedFrom', 'qualifiedTo', 'visitFrom', 'visitTo']) {
            const v = sp.get(k);
            if (v) { if (!DATE_RE.test(v)) return invalid(k, `${k} phải là yyyy-MM-dd`); filter[k] = v; }
        }
        for (const k of ['minVisits', 'minSpent']) {
            const v = sp.get(k);
            if (v) { const n = Number(v); if (!Number.isFinite(n) || n < 0) return invalid(k, `${k} không hợp lệ`); filter[k] = n; }
        }
        const pickEnum = (k: string, allowed: readonly string[], upper = true) => {
            const raw = sp.get(k);
            if (!raw) return true;
            const v = upper ? raw.toUpperCase() : raw.toLowerCase();
            if (!allowed.includes(v)) return false;
            filter[k] = v;
            return true;
        };
        if (!pickEnum('tier', PROMOTION_CUSTOMER_TIERS)) return invalid('tier', 'tier phải là NEW hoặc RETURNING');
        if (!pickEnum('vipMenu', ['USED', 'NOT_USED'])) return invalid('vipMenu', 'vipMenu phải là USED hoặc NOT_USED');
        if (!pickEnum('guestType', PROMOTION_GUEST_TYPES)) return invalid('guestType', 'guestType phải là SINGLE hoặc GROUP');
        if (!pickEnum('gender', PROMOTION_GENDERS)) return invalid('gender', 'gender không hợp lệ');
        if (!pickEnum('language', LANGS, false)) return invalid('language', 'language không hợp lệ');
        const nat = sp.get('nationality')?.trim();
        if (nat) filter.nationality = nat.slice(0, 60);
        const truthy = (v: string | null) => v === '1' || v === 'true';
        if (sp.has('onlyQualified')) filter.onlyQualified = truthy(sp.get('onlyQualified'));
        filter.hasEmail = sp.has('hasEmail') ? truthy(sp.get('hasEmail')) : true;

        const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 50);
        const offset = Math.max(Number(sp.get('offset')) || 0, 0);
        return promotionJson(await PromotionEngineService.getCustomerCandidates(id, filter, limit, offset));
    } catch (e) {
        return promotionInternalError(e);
    }
}
