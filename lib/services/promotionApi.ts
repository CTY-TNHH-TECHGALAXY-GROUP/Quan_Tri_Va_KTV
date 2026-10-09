/**
 * Promotion API adapter — the ONLY place UI code talks to the Promotion Engine.
 *
 * Two implementations behind one interface:
 *   - http: Agent A routes (`plans/plan_promotion_engine_backend.md` §5)
 *   - mock: in-memory fixtures (`promotionApi.mock.ts`) while the backend is not merged
 *
 * Mode: NEXT_PUBLIC_PROMOTION_API_MODE = 'mock' | 'http'.
 * Default is 'http' in production builds so a missing env never shows fake data to staff.
 *
 * Swapping to the real API must only touch this file (+ mapping), never the components.
 */
import { apiClient, ApiError } from '@/lib/apiClient';
import { createMockPromotionApi } from './promotionApi.mock';
import type {
  ApplyOverride,
  ApplyPromotionResult,
  BulkIssueResult,
  CustomerCandidateFilter,
  CustomerCandidatePage,
  IssuedPass,
  PassPage,
  PromotionMenu,
  CampaignFormInput,
  CampaignStatusAction,
  OrderCandidateFilter,
  PassListFilter,
  PassStatusAction,
  PromotionCampaign,
  PromotionErrorCode,
  PromotionOrderCandidate,
  PromotionOverviewStats,
  PromotionPass,
  PromotionPassWithQr,
  PromotionEmailLang,
  PromotionEmailPreview,
  PromotionResult,
  PromotionUsageRecord,
  SpaContact,
  UsageListFilter,
  WebClaimConfigInput,
  WebClaimOverview,
  WebClaimStats,
  WebClaimStatus,
} from '@/lib/types/promotion-client';

export interface PromotionApi {
  getOverview(): Promise<PromotionResult<PromotionOverviewStats>>;
  /** Hotline / address / website printed on the e-voucher (requested from Agent A). */
  getSpaContact(): Promise<PromotionResult<SpaContact>>;

  listCampaigns(): Promise<PromotionResult<PromotionCampaign[]>>;
  getCampaign(id: string): Promise<PromotionResult<PromotionCampaign>>;
  createCampaign(input: CampaignFormInput): Promise<PromotionResult<PromotionCampaign>>;
  /** Partial: an active campaign only takes name / description / validUntil. */
  updateCampaign(id: string, input: Partial<CampaignFormInput>): Promise<PromotionResult<PromotionCampaign>>;
  setCampaignStatus(id: string, action: CampaignStatusAction): Promise<PromotionResult<PromotionCampaign>>;

  /** Menu catalogue for "Menu áp dụng" in the campaign form. */
  getMenus(): Promise<PromotionResult<PromotionMenu[]>>;

  getPasses(filter?: PassListFilter): Promise<PromotionResult<PassPage>>;
  getPass(id: string): Promise<PromotionResult<PromotionPassWithQr>>;
  setPassStatus(id: string, action: PassStatusAction, reason?: string): Promise<PromotionResult<PromotionPass>>;
  /** Manual issue (+ e-voucher email). Conflict → error PASS_ALREADY_EXISTS with `data` = existing pass. */
  issuePass(campaignId: string, customerId: string): Promise<PromotionResult<IssuedPass>>;
  /** Re-send the e-voucher to the email currently on the customer profile. */
  sendPassEmail(id: string): Promise<PromotionResult<IssuedPass>>;
  /** The e-voucher email exactly as the owner receives it, in `lang` (default: the email language). */
  getEmailPreview(id: string, lang?: PromotionEmailLang): Promise<PromotionResult<PromotionEmailPreview>>;

  /** Customer profiles matching the criteria, for issuing this campaign. */
  getCustomerCandidates(campaignId: string, filter: CustomerCandidateFilter): Promise<PromotionResult<CustomerCandidatePage>>;
  /** Issue to many customers at once (max BULK_ISSUE_MAX). */
  bulkIssue(campaignId: string, customerIds: string[]): Promise<PromotionResult<BulkIssueResult>>;

  /** Scan = lookup only. Never consumes the pass. */
  getPassByToken(token: string): Promise<PromotionResult<PromotionPassWithQr>>;
  getPassByCode(code: string): Promise<PromotionResult<PromotionPassWithQr>>;

  /** Open orders a staff can apply this pass to (owner's first). */
  getActiveOrders(passId: string, filter?: OrderCandidateFilter): Promise<PromotionResult<PromotionOrderCandidate[]>>;
  /**
   * Unmet conditions → ORDER_CONDITION_NOT_MET with `data = { unmetReasons, canOverride }`;
   * resend with `override` (staff reason) to apply as an exception.
   */
  applyPass(passId: string, bookingId: string, override?: ApplyOverride): Promise<PromotionResult<ApplyPromotionResult>>;
  /** Only while the promotion service has not been dispatched (else PROMOTION_ITEM_IN_SERVICE). */
  cancelUsage(usageId: string, reason?: string): Promise<PromotionResult<unknown>>;

  getUsageHistory(filter?: UsageListFilter & { passId?: string }): Promise<PromotionResult<PromotionUsageRecord[]>>;

  /** Web Booking limited vouchers (engine v15): stock counters + voucher list. */
  getWebClaim(campaignId: string, status?: WebClaimStatus): Promise<PromotionResult<WebClaimOverview>>;
  /** Turns the campaign into WEB_CLAIM / edits quantity. Below allocated → QUANTITY_BELOW_ALLOCATED. */
  configureWebClaim(campaignId: string, input: WebClaimConfigInput): Promise<PromotionResult<WebClaimStats>>;
  setWebClaimPaused(campaignId: string, paused: boolean): Promise<PromotionResult<WebClaimStats>>;
  /** RESERVED only. No claimId = every reservation of the campaign. */
  releaseWebClaims(campaignId: string, reason: string, claimId?: string): Promise<PromotionResult<WebClaimStats & { released: number }>>;
}

// ─── HTTP implementation ────────────────────────────────────────────────

export { BULK_ISSUE_MAX } from '@/lib/types/promotion-client';

const ADMIN_BASE = '/api/admin/promotions';
const PASS_BASE = '/api/promotion-passes';

const toQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== false) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
};

const KNOWN_TRANSPORT_STATUS: Record<number, PromotionErrorCode> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
};

/** Normalises every failure into `{ success: false, error: { code, message } }`. */
type Envelope<T> = { success: boolean; data?: T; error?: unknown; meta?: { total?: number } & Record<string, unknown> };

const call = async <T, R = T>(
  run: () => Promise<unknown>,
  map: (data: T, res: Envelope<T>) => R = (d) => d as unknown as R,
): Promise<PromotionResult<R>> => {
  try {
    const res = (await run()) as Envelope<T>;
    if (res?.success) return { success: true, data: map(res.data as T, res) };
    return { success: false, error: readEnvelopeError(res?.error) };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = (err.data ?? {}) as { error?: unknown };
      const parsed = readEnvelopeError(body.error);
      if (parsed.code === 'UNKNOWN' && KNOWN_TRANSPORT_STATUS[err.status]) {
        return { success: false, error: { ...parsed, code: KNOWN_TRANSPORT_STATUS[err.status] } };
      }
      return { success: false, error: parsed };
    }
    return { success: false, error: { code: 'NETWORK_ERROR', message: String((err as Error)?.message ?? err) } };
  }
};

const readEnvelopeError = (raw: unknown): { code: PromotionErrorCode; message: string; data?: unknown } => {
  if (raw && typeof raw === 'object') {
    const e = raw as { code?: string; message?: string; data?: unknown; pass?: unknown };
    return { code: (e.code as PromotionErrorCode) || 'UNKNOWN', message: e.message || '', data: e.data ?? e.pass };
  }
  return { code: 'UNKNOWN', message: typeof raw === 'string' ? raw : '' };
};

const httpPromotionApi: PromotionApi = {
  getOverview: () => call(() => apiClient.get(`${ADMIN_BASE}/overview`)),
  getSpaContact: () => call(() => apiClient.get(`${ADMIN_BASE}/contact`)),

  listCampaigns: () => call(() => apiClient.get(`${ADMIN_BASE}/campaigns`)),
  getCampaign: (id) => call(() => apiClient.get(`${ADMIN_BASE}/campaigns/${encodeURIComponent(id)}`)),
  createCampaign: (input) => call(() => apiClient.post(`${ADMIN_BASE}/campaigns`, input)),
  updateCampaign: (id, input) => call(() => apiClient.patch(`${ADMIN_BASE}/campaigns/${encodeURIComponent(id)}`, input)),
  setCampaignStatus: (id, action) =>
    call(() => apiClient.post(`${ADMIN_BASE}/campaigns/${encodeURIComponent(id)}/status`, { action })),

  getMenus: () => call(() => apiClient.get(`${ADMIN_BASE}/menus`)),

  getPasses: (filter = {}) =>
    call<PromotionPass[], PassPage>(
      () =>
        apiClient.get(
          `${ADMIN_BASE}/passes${toQuery({
            q: filter.search,
            campaignId: filter.campaignId,
            group: filter.group,
            status: filter.status,
            expiry: filter.expiry,
            limit: filter.limit,
            offset: filter.offset,
          })}`,
        ),
      (rows, res) => ({ rows, total: res.meta?.total ?? rows.length }),
    ),
  getPass: (id) => call(() => apiClient.get(`${ADMIN_BASE}/passes/${encodeURIComponent(id)}`)),
  setPassStatus: (id, action, reason) =>
    call(() => apiClient.patch(`${ADMIN_BASE}/passes/${encodeURIComponent(id)}`, { action, reason })),
  issuePass: (campaignId, customerId) => call(() => apiClient.post(`${ADMIN_BASE}/passes`, { campaignId, customerId })),
  sendPassEmail: (id) => call(() => apiClient.post(`${ADMIN_BASE}/passes/${encodeURIComponent(id)}/send-email`, {})),
  getEmailPreview: (id, lang) =>
    call(() => apiClient.get(`${ADMIN_BASE}/passes/${encodeURIComponent(id)}/email-preview${lang ? `?lang=${lang}` : ''}`)),

  getCustomerCandidates: (campaignId, f) =>
    call(() =>
      apiClient.get(
        `${ADMIN_BASE}/campaigns/${encodeURIComponent(campaignId)}/customer-candidates${toQuery({
          q: f.search,
          onlyQualified: f.onlyQualified,
          qualifiedFrom: f.qualifiedFrom,
          qualifiedTo: f.qualifiedTo,
          visitFrom: f.visitFrom,
          visitTo: f.visitTo,
          minVisits: f.minVisits,
          minSpent: f.minSpent,
          tier: f.tier,
          vipMenu: f.vipMenu,
          guestType: f.guestType,
          gender: f.gender,
          nationality: f.nationality,
          language: f.language,
          // hasEmail defaults to true server-side too; send explicitly so "false" is honoured.
          hasEmail: f.hasEmail === false ? '0' : '1',
          limit: f.limit,
          offset: f.offset,
        })}`,
      ),
    ),
  bulkIssue: (campaignId, customerIds) => call(() => apiClient.post(`${ADMIN_BASE}/passes/bulk`, { campaignId, customerIds })),

  getPassByToken: (token) => call(() => apiClient.get(`${PASS_BASE}/lookup${toQuery({ t: token })}`)),
  getPassByCode: (code) => call(() => apiClient.get(`${PASS_BASE}/lookup${toQuery({ code })}`)),

  getActiveOrders: (passId, filter = {}) =>
    call(() => apiClient.get(`${PASS_BASE}/${encodeURIComponent(passId)}/active-orders${toQuery({ q: filter.search })}`)),
  applyPass: (passId, bookingId, override) =>
    call(() =>
      apiClient.post(
        `${PASS_BASE}/${encodeURIComponent(passId)}/apply`,
        override ? { bookingId, overrideConditions: true, overrideNote: override.note.trim() } : { bookingId },
      ),
    ),
  cancelUsage: (usageId, reason) =>
    call(() => apiClient.post(`/api/promotion-usages/${encodeURIComponent(usageId)}/cancel`, reason ? { reason } : {})),

  getUsageHistory: (filter = {}) =>
    call(() =>
      apiClient.get(
        `${ADMIN_BASE}/usages${toQuery({
          from: filter.dateFrom,
          to: filter.dateTo,
          campaignId: filter.campaignId,
          status: filter.status,
          q: filter.search,
          passId: filter.passId,
          overridden: filter.overridden ? '1' : undefined,
        })}`,
      ),
    ),

  getWebClaim: (campaignId, status) =>
    call(() => apiClient.get(`${ADMIN_BASE}/campaigns/${encodeURIComponent(campaignId)}/web-claim${toQuery({ status })}`)),
  configureWebClaim: (campaignId, input) =>
    call(() => apiClient.patch(`${ADMIN_BASE}/campaigns/${encodeURIComponent(campaignId)}/web-claim`, input)),
  setWebClaimPaused: (campaignId, paused) =>
    call(() => apiClient.post(`${ADMIN_BASE}/campaigns/${encodeURIComponent(campaignId)}/web-claim/pause`, { paused })),
  releaseWebClaims: (campaignId, reason, claimId) =>
    call(() =>
      apiClient.post(`${ADMIN_BASE}/campaigns/${encodeURIComponent(campaignId)}/web-claim/release`, claimId ? { claimId, reason } : { reason }),
    ),
};

// ─── Mode switch ────────────────────────────────────────────────────────

const resolveMode = (): 'mock' | 'http' => {
  const explicit = process.env.NEXT_PUBLIC_PROMOTION_API_MODE;
  if (explicit === 'mock' || explicit === 'http') return explicit;
  return process.env.NODE_ENV === 'production' ? 'http' : 'mock';
};

export const PROMOTION_API_MODE = resolveMode();

export const promotionApi: PromotionApi =
  PROMOTION_API_MODE === 'mock' ? createMockPromotionApi() : httpPromotionApi;
