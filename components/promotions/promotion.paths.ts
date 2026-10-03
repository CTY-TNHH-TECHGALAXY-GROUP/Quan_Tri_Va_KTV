export const PROMOTION_PATHS = {
  overview: '/admin/promotions',
  campaigns: '/admin/promotions/campaigns',
  newCampaign: '/admin/promotions/campaigns/new',
  campaign: (id: string) => `/admin/promotions/campaigns/${encodeURIComponent(id)}`,
  editCampaign: (id: string) => `/admin/promotions/campaigns/${encodeURIComponent(id)}/edit`,
  passes: '/admin/promotions/passes',
  pass: (id: string) => `/admin/promotions/passes/${encodeURIComponent(id)}`,
  usages: '/admin/promotions/usages',
  scan: '/admin/promotions/scan',
  /** Existing dispatch board — where reception sees the order with the KM item (no per-order deep link yet). */
  dispatch: '/reception/dispatch',
};
