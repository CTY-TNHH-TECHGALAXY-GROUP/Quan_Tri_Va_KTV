import { promotionCan, type PromotionAction } from '@/lib/constants/promotion';
import { PROMOTION_PATHS } from './promotion.paths';

/**
 * What a user sees in the Promotions module, derived ONLY from the engine's
 * `promotionCan` (Agent A, lib/constants/promotion.ts) — the same table the
 * API guards use, so UI and server never disagree. The server still blocks;
 * this only avoids showing buttons that would answer 403.
 */
export const promotionAccess = (permissions: readonly string[] | null | undefined) => {
  const can = (a: PromotionAction) => promotionCan(permissions, a);
  const view = can('pass.view');
  const campaignRead = can('campaign.read');
  const scan = can('scan.apply');
  const any = view || campaignRead || scan || can('pass.issue') || can('campaign.manage') || can('apply.override');
  return {
    can,
    /** Show the single "Khuyến Mãi" Sidebar entry. */
    any,
    /** Where that entry goes: scan-only staff land on the scanner. */
    home: view || campaignRead ? PROMOTION_PATHS.overview : PROMOTION_PATHS.scan,
    tabs: { overview: view, campaigns: campaignRead, passes: view, usages: view },
    scan,
    createCampaign: can('campaign.manage'),
    manageCampaign: can('campaign.manage'),
    issue: can('pass.issue'),
    cancelUsage: scan,
    override: can('apply.override'),
    /** Back from the scanner. */
    scanBack: view ? PROMOTION_PATHS.overview : PROMOTION_PATHS.dispatch,
  };
};

export type PromotionAccess = ReturnType<typeof promotionAccess>;
