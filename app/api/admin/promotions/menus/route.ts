import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { PROMOTION_ADMIN_PERMISSION, authorizePromotion, promotionInternalError, promotionJson } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

// GET /api/admin/promotions/menus — live catalogue for "Menu áp dụng" in the campaign form.
// [{ code: 'NHP', label: 'Menu VIP', serviceCount, categories: [{ code, label, serviceCount }], services: [...] }]
// Menus = service id prefixes found in Services; labels from SystemConfigs.promotion_menu_labels.
export async function GET() {
    const auth = await authorizePromotion(PROMOTION_ADMIN_PERMISSION);
    if (auth instanceof Response) return auth;
    try {
        return promotionJson(await PromotionEngineService.getMenuCatalog());
    } catch (e) {
        return promotionInternalError(e);
    }
}
