import { NextRequest } from 'next/server';
import { PromotionEngineService, maskPassPii } from '@/lib/services/PromotionEngineService';
import { authorizePromotion, promotionInternalError, promotionJson,
} from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/promotion-passes/lookup?t=<qrToken>  |  ?code=<voucherCode>
// Accepts the full scanned URL in `t` too (…/promotion/scan?t=xxx).
export async function GET(request: NextRequest) {
    const auth = await authorizePromotion('scan.apply');
    if (auth instanceof Response) return auth;
    try {
        let token = request.nextUrl.searchParams.get('t');
        const code = request.nextUrl.searchParams.get('code');
        if (token && token.includes('?')) {
            try { token = new URL(token).searchParams.get('t'); } catch { /* keep raw */ }
        }
        if (token && token.length > 200) token = null;
        if (code && code.length > 40) {
            return promotionJson({ success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Mã voucher không hợp lệ' } });
        }
        const res = await PromotionEngineService.lookupPass({ qrToken: token, voucherCode: code });
        if (res.success && !auth.can('customer.pii')) return promotionJson({ success: true, data: maskPassPii(res.data) });
        return promotionJson(res);
    } catch (e) {
        return promotionInternalError(e);
    }
}
