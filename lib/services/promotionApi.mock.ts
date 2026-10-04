/**
 * In-memory mock of the Promotion Engine API (contract v2) — DEV ONLY.
 *
 * Simulates the server so the UI can be built before Agent A's routes are
 * merged. The rules here only exist to produce realistic responses and error
 * codes; the real authority is the `promo_*` RPCs.
 *
 * Scenario vouchers (type the code in the scanner's manual box):
 *   OCT30-X7K92A  ACTIVE, unlimited, owner has 1 open order (+ other guests' orders)
 *   OCT30-MULTI2  ACTIVE, owner has 2 open orders
 *   OCT30-NOORD0  ACTIVE, nobody has open orders that can take it
 *   SEP30-EXP001  EXPIRED
 *   OCT30-CANC01  CANCELLED
 *   TEN10-LIM009  LIMITED 10, used 9 → one apply left, then USAGE_LIMIT_REACHED
 *   anything else → PROMOTION_NOT_FOUND
 */
import type { PromotionApi } from './promotionApi';
import { BULK_ISSUE_MAX } from '@/lib/types/promotion-client';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';
import type {
  BulkIssueItem,
  CampaignFormInput,
  CustomerCandidate,
  IssuedPass,
  PromotionBooking,
  PromotionApplyConditions,
  PromotionCampaign,
  PromotionConditionsSummary,
  PromotionErrorCode,
  PromotionMenu,
  PromotionOrderCandidate,
  PromotionPass,
  PromotionPassEffectiveStatus,
  PromotionPassWithQr,
  PromotionResult,
  PromotionUsageRecord,
} from '@/lib/types/promotion-client';
import { MOCK_MENUS } from './promotionApi.mock.menus';

const MOCK_LATENCY_MS = 350;
const MOCK_SCAN_BASE = 'https://admin.example/voucher?t=';

const delay = () => new Promise((r) => setTimeout(r, MOCK_LATENCY_MS));
const ok = <T>(data: T): PromotionResult<T> => ({ success: true, data: structuredClone(data) });
const fail = <T>(code: PromotionErrorCode, data?: unknown): PromotionResult<T> => ({
  success: false,
  error: { code, message: code, data },
});

const vnEndOfDay = (date: string) => `${date}T23:59:59+07:00`;
const vnStartOfDay = (date: string) => `${date}T00:00:00+07:00`;
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const MENUS: PromotionMenu[] = MOCK_MENUS;

/** Mirror of the engine's label resolution (display only). */
const summaryOf = (ac: PromotionApplyConditions): PromotionConditionsSummary => ({
  match: ac.match,
  conditions: ac.conditions.map((c) => ({
    menus: c.menus.map((code) => MENUS.find((m) => m.code === code)?.label ?? code),
    categories: c.categories.map((code) => MENUS.flatMap((m) => m.categories).find((x) => x.code === code)?.label ?? code),
    services: c.serviceIds.map((id) => MENUS.flatMap((m) => m.services).find((x) => x.id === id)?.name ?? id),
    minMinutes: c.minMinutes,
    minOrderAmount: c.minOrderAmount,
  })),
});
const NO_CONDITIONS: PromotionApplyConditions = { match: 'ALL', conditions: [] };
const VIP_90: PromotionApplyConditions = { match: 'ALL', conditions: [{ menus: ['NHP'], categories: [], serviceIds: [], minMinutes: 90, minOrderAmount: null }] };

const CANDIDATES: CustomerCandidate[] = [
  { id: 'CUS001', name: 'Charlotte Nguyen', phone: '0901234567', email: 'charlotte@example.com', gender: 'FEMALE', nationality: 'Việt Nam', language: 'vi', visitCount: 12, totalSpent: 14_400_000, lastVisitAt: '2026-10-01T18:05:00', vipMenuCount: 9, guestType: 'SINGLE', qualifyingOrderCount: 6 },
  { id: 'CUS002', name: 'Minh Tran', phone: '0912345678', email: 'minh@example.com', gender: 'MALE', nationality: 'Việt Nam', language: 'vi', visitCount: 3, totalSpent: 2_850_000, lastVisitAt: '2026-09-30T19:10:00', vipMenuCount: 1, guestType: 'GROUP', qualifyingOrderCount: 1 },
  { id: 'CUS003', name: 'Lan Pham', phone: '0987654321', email: 'lan@example.com', gender: 'FEMALE', nationality: 'Việt Nam', language: 'vi', visitCount: 1, totalSpent: 950_000, lastVisitAt: '2026-09-29T14:00:00', vipMenuCount: 0, guestType: 'SINGLE', qualifyingOrderCount: 0 },
  { id: 'CUS004', name: 'Kenji Sato', phone: '+81901112222', email: 'kenji@example.jp', gender: 'MALE', nationality: 'Nhật Bản', language: 'jp', visitCount: 5, totalSpent: 6_200_000, lastVisitAt: '2026-09-20T16:00:00', vipMenuCount: 4, guestType: 'SINGLE', qualifyingOrderCount: 3 },
  { id: 'CUS005', name: 'Kim Min-ji', phone: '+821012345678', email: null, gender: 'FEMALE', nationality: 'Hàn Quốc', language: 'kr', visitCount: 2, totalSpent: 1_900_000, lastVisitAt: '2026-09-15T20:00:00', vipMenuCount: 2, guestType: 'GROUP', qualifyingOrderCount: 2 },
  ...Array.from({ length: 80 }, (_, i): CustomerCandidate => ({
    id: `CUS1${String(i).padStart(2, '0')}`,
    name: `Khách mẫu ${i + 1}`,
    phone: `09000000${String(i).padStart(2, '0')}`,
    email: i % 7 === 0 ? null : `khach${i + 1}@example.com`,
    gender: i % 2 ? 'MALE' : 'FEMALE',
    nationality: i % 3 ? 'Việt Nam' : 'Hoa Kỳ',
    language: i % 3 ? 'vi' : 'en',
    visitCount: (i % 12) + 1,
    totalSpent: ((i % 12) + 1) * 900_000,
    lastVisitAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T15:00:00`,
    vipMenuCount: i % 4,
    guestType: i % 5 ? 'SINGLE' : 'GROUP',
    qualifyingOrderCount: i % 4,
  })),
];


const refOf = (c: CustomerCandidate) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email });

const buildFixtures = () => {
  const campaigns: PromotionCampaign[] = [
    {
      id: 'CMP_OCT30',
      campaignCode: 'OCT_FREE30_2026',
      name: 'October +30 Minutes',
      nameI18n: { vi: 'Tháng 10 tặng thêm 30 phút', jp: '10月 +30分プレゼント' },
      descriptionI18n: {},
      description: 'Tặng thêm 30 phút cho đơn VIP từ 90 phút.',
      benefit: { type: 'FREE_MINUTES', value: 30, config: {}, serviceId: 'KM0001' },
      usage: { type: 'UNLIMITED', limit: null, maxPerOrder: 1, maxPerCustomer: null },
      qualification: { type: 'MANUAL_ASSIGNMENT', value: null, config: null },
      applicableMenus: { menus: ['NHP'], categories: [], serviceIds: [], allMenus: false },
      applyConditions: VIP_90,
      conditionsSummary: summaryOf(VIP_90),
      validity: { type: 'CAMPAIGN_PERIOD', days: null },
      assignmentMode: 'MANUAL_ONLY',
      status: 'ACTIVE',
      validFrom: vnStartOfDay('2026-10-01'),
      validUntil: vnEndOfDay('2026-10-31'),
      voucherPrefix: 'OCT30',
      issuedPassCount: 4,
      usageCount: 6,
      createdAt: '2026-09-28T10:00:00+07:00',
    },
    {
      id: 'CMP_TEN10',
      campaignCode: 'TEN10',
      name: 'Thẻ 10 lần +30 phút',
      description: null,
      benefit: { type: 'FREE_MINUTES', value: 30, config: {}, serviceId: 'KM0002' },
      usage: { type: 'LIMITED', limit: 10, maxPerOrder: 1, maxPerCustomer: null },
      qualification: { type: 'MANUAL_ASSIGNMENT', value: null, config: null },
      applicableMenus: { menus: [], categories: [], serviceIds: [], allMenus: true },
      applyConditions: NO_CONDITIONS,
      conditionsSummary: summaryOf(NO_CONDITIONS),
      validity: { type: 'DAYS_FROM_ISSUE', days: 90 },
      assignmentMode: 'MANUAL_ONLY',
      status: 'ACTIVE',
      validFrom: vnStartOfDay('2026-09-01'),
      validUntil: vnEndOfDay('2026-12-31'),
      voucherPrefix: 'TEN10',
      issuedPassCount: 1,
      usageCount: 9,
      createdAt: '2026-08-30T10:00:00+07:00',
    },
    {
      id: 'CMP_SEP30',
      campaignCode: 'SEP30',
      name: 'September +30 Minutes',
      description: null,
      benefit: { type: 'FREE_MINUTES', value: 30, config: {}, serviceId: 'KM0001' },
      usage: { type: 'UNLIMITED', limit: null, maxPerOrder: 1, maxPerCustomer: null },
      qualification: { type: 'MANUAL_ASSIGNMENT', value: null, config: null },
      applicableMenus: { menus: ['NHP'], categories: [], serviceIds: [], allMenus: false },
      applyConditions: VIP_90,
      conditionsSummary: summaryOf(VIP_90),
      validity: { type: 'CAMPAIGN_PERIOD', days: null },
      assignmentMode: 'MANUAL_ONLY',
      status: 'ENDED',
      validFrom: vnStartOfDay('2026-09-01'),
      validUntil: vnEndOfDay('2026-09-30'),
      voucherPrefix: 'SEP30',
      issuedPassCount: 12,
      usageCount: 20,
      createdAt: '2026-08-25T10:00:00+07:00',
    },
  ];

  const pass = (
    id: string,
    voucherCode: string,
    campaignId: string,
    customer: CustomerCandidate,
    over: Partial<PromotionPassWithQr> = {},
  ): PromotionPassWithQr => {
    const c = campaigns.find((x) => x.id === campaignId)!;
    return {
      id,
      voucherCode,
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      statusReason: null,
      campaign: { id: c.id, name: c.name, nameI18n: c.nameI18n, campaignCode: c.campaignCode, status: c.status },
      customer: refOf(customer),
      benefit: { type: c.benefit.type, value: c.benefit.value },
      usage: { type: c.usage.type, limit: c.usage.limit, maxPerOrder: c.usage.maxPerOrder, usedCount: 0 },
      validFrom: c.validFrom,
      validUntil: c.validUntil,
      issuedAt: '2026-10-01T15:20:00+07:00',
      issueSource: 'MANUAL',
      issuedBy: 'admin',
      lastUsedAt: null,
      sourceBookingId: null,
      emailStatus: customer.email ? 'SENT' : 'SKIPPED',
      emailTo: customer.email,
      emailSentAt: customer.email ? '2026-10-01T15:20:05+07:00' : null,
      emailLastError: null,
      qrPayload: `${MOCK_SCAN_BASE}mock-qr-token-${id}`,
      conditionsSummary: c.conditionsSummary,
      ...over,
    };
  };

  const [charlotte, minh, lan, kenji] = CANDIDATES;
  const passes: PromotionPassWithQr[] = [
    pass('PASS_001', 'OCT30-X7K92A', 'CMP_OCT30', charlotte, {
      usage: { type: 'UNLIMITED', limit: null, usedCount: 4, maxPerOrder: 1 },
      lastUsedAt: '2026-10-01T18:05:00+07:00',
    }),
    pass('PASS_002', 'OCT30-MULTI2', 'CMP_OCT30', minh, { emailStatus: 'FAILED', emailSentAt: null, emailLastError: 'SMTP timeout' }),
    pass('PASS_003', 'OCT30-NOORD0', 'CMP_OCT30', kenji),
    pass('PASS_004', 'SEP30-EXP001', 'CMP_SEP30', charlotte, {
      status: 'EXPIRED',
      effectiveStatus: 'EXPIRED',
      usage: { type: 'UNLIMITED', limit: null, usedCount: 3, maxPerOrder: 1 },
      lastUsedAt: '2026-09-27T20:00:00+07:00',
    }),
    pass('PASS_005', 'OCT30-CANC01', 'CMP_OCT30', lan, { status: 'CANCELLED', effectiveStatus: 'CANCELLED', statusReason: 'Phát nhầm' }),
    pass('PASS_006', 'TEN10-LIM009', 'CMP_TEN10', lan, {
      usage: { type: 'LIMITED', limit: 10, usedCount: 9, maxPerOrder: 1 },
      lastUsedAt: '2026-09-29T14:00:00+07:00',
      validUntil: vnEndOfDay('2026-12-28'),
    }),
  ];

  type MockOrder = PromotionBooking & { customerId: string };
  const order = (
    id: string,
    billCode: string,
    customer: CustomerCandidate,
    hhmm: string,
    serviceName: string,
    minutes: number,
    price: number,
    status: string = 'NEW',
  ): MockOrder => ({
    id,
    billCode,
    displayCode: billCode.split('-')[0],
    customerId: customer.id,
    customerName: customer.name,
    status,
    bookingTime: hhmm,
    roomLabel: status === 'NEW' ? null : 'P.203',
    totalAmount: price,
    totalDurationMinutes: minutes,
    items: [{ id: `${id}-1`, serviceName, durationMinutes: minutes, price, isPromotion: false }],
  });

  const day = vnToday().slice(2).split('-').reverse().join('');
  const orders: MockOrder[] = [
    order('BK_1028', `NH-${day}-028`, charlotte, '14:30', 'Aroma Massage', 90, 1_200_000),
    order('BK_1031', `NH-${day}-031`, minh, '15:00', 'Hot Stone VIP', 120, 1_650_000, 'PREPARING'),
    order('BK_1032', `NH-${day}-032`, minh, '17:30', 'Foot Massage', 60, 450_000),
    order('BK_1035', `NH-${day}-035`, lan, '16:00', 'Thai Massage', 90, 950_000, 'IN_PROGRESS'),
  ];

  const usages: PromotionUsageRecord[] = [
    ['2026-10-01T18:05:00+07:00', 'NH-011026-098', charlotte],
    ['2026-09-30T19:10:00+07:00', 'NH-300926-051', minh],
    ['2026-09-29T14:00:00+07:00', 'NH-290926-003', charlotte],
    ['2026-09-28T20:30:00+07:00', 'NH-280926-070', minh],
  ].map(([appliedAt, billCode, cus], i) => ({
    id: `USG_00${i + 1}`,
    appliedAt: appliedAt as string,
    status: 'COMPLETED',
    benefit: { type: 'FREE_MINUTES', value: 30 },
    appliedMinutes: 30,
    discountAmount: 0,
    passId: 'PASS_001',
    voucherCode: 'OCT30-X7K92A',
    campaignName: 'October +30 Minutes',
    customer: refOf(cus as CustomerCandidate),
    passOwner: { id: charlotte.id, name: charlotte.name },
    booking: { id: `BK_${billCode}`, billCode: billCode as string, displayCode: 'NH' },
    staffName: 'Lễ tân Hà',
  }));

  return { campaigns, passes, orders, usages };
};

export const createMockPromotionApi = (): PromotionApi => {
  const db = buildFixtures();
  let seq = 100;

  const stripQr = ({ qrPayload: _omit, ...rest }: PromotionPassWithQr): PromotionPass => rest;

  const effective = (p: PromotionPassWithQr): PromotionPassEffectiveStatus => {
    if (p.status !== 'ACTIVE') return p.status;
    if (Date.parse(p.validUntil) < Date.now()) return 'EXPIRED';
    if (p.usage.type !== 'UNLIMITED' && p.usage.usedCount >= (p.usage.limit ?? 1)) return 'USED_UP';
    if (Date.parse(p.validFrom) > Date.now()) return 'NOT_STARTED';
    const c = db.campaigns.find((x) => x.id === p.campaign.id);
    return c && c.status !== 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  };
  const groupOf = (p: PromotionPassWithQr): 'ACTIVE' | 'PAST' =>
    p.effectiveStatus === 'EXPIRED' || p.effectiveStatus === 'USED_UP' || p.effectiveStatus === 'CANCELLED' ? 'PAST' : 'ACTIVE';

  const refresh = (p: PromotionPassWithQr) => {
    p.effectiveStatus = effective(p);
    p.endedAt = groupOf(p) === 'PAST' ? (p.status === 'CANCELLED' ? p.issuedAt : p.effectiveStatus === 'USED_UP' ? p.lastUsedAt : p.validUntil) : null;
    p.campaign.status = db.campaigns.find((x) => x.id === p.campaign.id)?.status;
    return p;
  };

  const passIsUsable = (p: PromotionPassWithQr): PromotionErrorCode | null => {
    const map: Partial<Record<PromotionPassEffectiveStatus, PromotionErrorCode>> = {
      CANCELLED: 'PROMOTION_CANCELLED',
      USED_UP: 'PROMOTION_USED_UP',
      SUSPENDED: 'PROMOTION_SUSPENDED',
      EXPIRED: 'PROMOTION_EXPIRED',
      NOT_STARTED: 'PROMOTION_NOT_STARTED',
      INACTIVE: 'PROMOTION_INACTIVE',
    };
    const blocked = map[effective(p)];
    if (blocked) return blocked;
    if (p.usage.type !== 'UNLIMITED' && p.usage.limit != null && p.usage.usedCount >= p.usage.limit) {
      return 'PROMOTION_USAGE_LIMIT_REACHED';
    }
    return null;
  };

  const toBooking = (o: (typeof db.orders)[number]): PromotionBooking => {
    const { customerId: _c, ...rest } = o;
    return {
      ...rest,
      totalAmount: o.items.reduce((s, it) => s + it.price, 0),
      totalDurationMinutes: o.items.reduce((s, it) => s + it.durationMinutes, 0),
    };
  };

  const toCandidate = (o: (typeof db.orders)[number], p: PromotionPassWithQr): PromotionOrderCandidate => {
    const already = db.usages.some((u) => u.passId === p.id && u.booking.id === o.id && u.status !== 'CANCELLED');
    const blocked: PromotionErrorCode | null = already ? 'PROMOTION_ALREADY_APPLIED' : passIsUsable(p);
    // Conditions (v7/v8): only the per-service minimum minutes is simulated here.
    const first = p.conditionsSummary?.conditions[0];
    const min = first?.minMinutes ?? null;
    const longest = Math.max(0, ...o.items.filter((i) => !i.isPromotion).map((i) => i.durationMinutes));
    const unmet =
      !blocked && min && longest < min
        ? [`Cần ${formatPromotionConditions(p.conditionsSummary, 'vi')[0]} — dịch vụ phù hợp dài nhất của đơn là ${longest} phút`]
        : [];
    return {
      ...toBooking(o),
      isPassOwnerOrder: o.customerId === p.customer.id,
      canApply: blocked === null && unmet.length === 0,
      blockedReasonCode: blocked,
      blockedReason: blocked,
      eligibility: blocked ? 'BLOCKED' : unmet.length ? 'NOT_ELIGIBLE' : 'ELIGIBLE',
      canOverride: !blocked && unmet.length > 0,
      unmetReasons: unmet,
    };
  };

  const fromForm = (input: CampaignFormInput, base?: PromotionCampaign): PromotionCampaign => {
    const menus = [...new Set(input.applyConditions.conditions.flatMap((c) => c.menus))];
    return {
      id: base?.id ?? `CMP_${++seq}`,
      campaignCode: input.campaignCode,
      name: input.name,
      description: input.description || null,
      nameI18n: input.nameI18n ?? {},
      descriptionI18n: input.descriptionI18n ?? {},
      benefit: { type: input.benefitType, value: input.benefitValue ?? 0, config: input.benefitConfig ?? {}, serviceId: base?.benefit.serviceId ?? null },
      usage: {
        type: input.usageType,
        limit: input.usageType === 'LIMITED' ? input.usageLimit : input.usageType === 'ONE_TIME' ? 1 : null,
        maxPerOrder: input.maxUsagePerOrder,
        maxPerCustomer: null,
      },
      qualification: { type: 'MANUAL_ASSIGNMENT', value: null, config: null },
      applicableMenus: { menus, categories: [], serviceIds: [], allMenus: menus.length === 0 },
      applyConditions: input.applyConditions,
      conditionsSummary: summaryOf(input.applyConditions),
      validity: { type: input.validityType, days: input.validityType === 'DAYS_FROM_ISSUE' ? input.validityDays : null },
      assignmentMode: input.assignmentMode,
      status: base?.status ?? 'DRAFT',
      validFrom: vnStartOfDay(input.validFrom),
      validUntil: vnEndOfDay(input.validUntil),
      voucherPrefix: input.voucherPrefix,
      issuedPassCount: base?.issuedPassCount ?? 0,
      usageCount: base?.usageCount ?? 0,
      createdAt: base?.createdAt ?? new Date().toISOString(),
    };
  };

  const RULE_KEYS: (keyof CampaignFormInput)[] = ['benefitType', 'benefitValue', 'usageType', 'usageLimit', 'maxUsagePerOrder', 'applyConditions', 'validityType', 'validityDays', 'validFrom'];

  const issueOne = (c: PromotionCampaign, cus: CustomerCandidate): IssuedPass => {
    const id = `PASS_${++seq}`;
    const issuedAt = new Date().toISOString();
    const validUntil =
      c.validity?.type === 'DAYS_FROM_ISSUE' && c.validity.days
        ? new Date(Math.min(Date.now() + c.validity.days * 86400_000, Date.parse(c.validUntil))).toISOString()
        : c.validUntil;
    const p: PromotionPassWithQr = {
      id,
      voucherCode: `${c.voucherPrefix || 'KM'}-M${String(seq).padStart(5, '0')}`,
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      statusReason: null,
      campaign: { id: c.id, name: c.name, nameI18n: c.nameI18n, campaignCode: c.campaignCode, status: c.status },
      customer: refOf(cus),
      benefit: { type: c.benefit.type, value: c.benefit.value },
      usage: { type: c.usage.type, limit: c.usage.limit, maxPerOrder: c.usage.maxPerOrder, usedCount: 0 },
      validFrom: c.validFrom,
      validUntil,
      issuedAt,
      issueSource: 'MANUAL',
      issuedBy: 'admin',
      lastUsedAt: null,
      sourceBookingId: null,
      emailStatus: cus.email ? 'SENT' : 'SKIPPED',
      emailTo: cus.email,
      emailSentAt: cus.email ? issuedAt : null,
      emailLastError: null,
      qrPayload: `${MOCK_SCAN_BASE}mock-qr-token-${id}`,
      conditionsSummary: c.conditionsSummary,
    };
    db.passes.unshift(refresh(p));
    return { ...structuredClone(p), emailDelivery: cus.email ? { status: 'SENT' } : { status: 'SKIPPED', reason: 'CUSTOMER_NO_EMAIL' } };
  };

  return {
    async getSpaContact() {
      await delay();
      // Mirrors EMAIL_CONFIG_DEFAULTS (lib/email-config.ts); the real API reads the saved email config.
      return ok({ brandName: 'ORIA SPA', hotline: '+84 964 090 277', address: '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh', websiteUrl: 'https://oria-spa.vercel.app' });
    },

    async getOverview() {
      await delay();
      db.passes.forEach(refresh);
      return ok({
        activeCampaigns: db.campaigns.filter((c) => c.status === 'ACTIVE').length,
        passesIssued: db.passes.length,
        activePasses: db.passes.filter((p) => groupOf(p) === 'ACTIVE').length,
        pastPasses: db.passes.filter((p) => groupOf(p) === 'PAST').length,
        usesThisMonth: db.usages.filter((u) => u.appliedAt.startsWith('2026-10')).length,
      });
    },

    async listCampaigns() {
      await delay();
      return ok(db.campaigns);
    },
    async getCampaign(id) {
      await delay();
      const c = db.campaigns.find((x) => x.id === id);
      return c ? ok(c) : fail('CAMPAIGN_NOT_FOUND');
    },
    async createCampaign(input) {
      await delay();
      if (db.campaigns.some((c) => c.campaignCode.toUpperCase() === input.campaignCode.toUpperCase())) return fail('CAMPAIGN_CODE_EXISTS');
      const c = fromForm(input);
      db.campaigns.unshift(c);
      return ok(c);
    },
    async updateCampaign(id, input) {
      await delay();
      const idx = db.campaigns.findIndex((x) => x.id === id);
      if (idx < 0) return fail('CAMPAIGN_NOT_FOUND');
      const base = db.campaigns[idx];
      if (base.status === 'ENDED') return fail('CAMPAIGN_ENDED');
      const next = fromForm({ ...campaignFormOf(base), ...input }, base);
      if (base.status !== 'DRAFT') {
        const changed = RULE_KEYS.filter((k) => JSON.stringify(pickRules(next)[k]) !== JSON.stringify(pickRules(base)[k]));
        if (changed.length) return fail('CAMPAIGN_LOCKED', { fields: changed });
      }
      db.campaigns[idx] = next;
      return ok(next);
    },
    async setCampaignStatus(id, action) {
      await delay();
      const c = db.campaigns.find((x) => x.id === id);
      if (!c) return fail('CAMPAIGN_NOT_FOUND');
      c.status = action === 'ACTIVATE' ? 'ACTIVE' : action === 'DEACTIVATE' ? 'INACTIVE' : 'ENDED';
      return ok(c);
    },

    async getMenus() {
      await delay();
      return ok(MENUS);
    },

    async getPasses(filter = {}) {
      await delay();
      db.passes.forEach(refresh);
      const q = filter.search?.trim().toLowerCase();
      const now = Date.now();
      const base = db.passes.filter((p) => {
        if (filter.campaignId && p.campaign.id !== filter.campaignId) return false;
        if (!q) return true;
        return [p.customer.name, p.customer.phone, p.customer.email, p.voucherCode].some((v) => v?.toLowerCase().includes(q));
      });
      const rows = base.filter((p) => {
        if (filter.group && groupOf(p) !== filter.group) return false;
        if (filter.status && p.effectiveStatus !== filter.status) return false;
        const until = Date.parse(p.validUntil);
        if (filter.expiry === 'EXPIRED' && until >= now) return false;
        if (filter.expiry === 'VALID' && until < now) return false;
        if (filter.expiry === 'EXPIRING_7D' && (until < now || until > now + 7 * 86400_000)) return false;
        return true;
      });
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 50;
      // List rows never carry the QR payload.
      const sorted = [...rows].sort((a, b) =>
        filter.group === 'PAST' ? (b.endedAt ?? '').localeCompare(a.endedAt ?? '') : a.validUntil.localeCompare(b.validUntil),
      );
      return ok({ rows: sorted.slice(offset, offset + limit).map(stripQr), total: rows.length });
    },
    async getPass(id) {
      await delay();
      const p = db.passes.find((x) => x.id === id);
      return p ? ok(refresh(p)) : fail('PROMOTION_NOT_FOUND');
    },
    async setPassStatus(id, action, reason) {
      await delay();
      const p = db.passes.find((x) => x.id === id);
      if (!p) return fail('PROMOTION_NOT_FOUND');
      p.status = action === 'SUSPEND' ? 'SUSPENDED' : action === 'CANCEL' ? 'CANCELLED' : 'ACTIVE';
      p.statusReason = reason ?? null;
      return ok(stripQr(refresh(p)));
    },
    async issuePass(campaignId, customerId) {
      await delay();
      const c = db.campaigns.find((x) => x.id === campaignId);
      if (!c) return fail('CAMPAIGN_NOT_FOUND');
      const cus = CANDIDATES.find((x) => x.id === customerId);
      if (!cus) return fail('CUSTOMER_NOT_FOUND');
      const existing = db.passes.find((p) => p.campaign.id === campaignId && p.customer.id === customerId);
      if (existing) return fail('PASS_ALREADY_EXISTS', structuredClone(existing));
      return ok(issueOne(c, cus));
    },
    async sendPassEmail(id) {
      await delay();
      const p = db.passes.find((x) => x.id === id);
      if (!p) return fail('PROMOTION_NOT_FOUND');
      if (!p.customer.email) return fail('CUSTOMER_NO_EMAIL');
      if (effective(p) === 'EXPIRED') return fail('PROMOTION_EXPIRED');
      if (effective(p) === 'CANCELLED') return fail('PROMOTION_CANCELLED');
      p.emailStatus = 'SENT';
      p.emailSentAt = new Date().toISOString();
      p.emailLastError = null;
      return ok({ ...structuredClone(p), emailDelivery: { status: 'SENT' } });
    },

    async getCustomerCandidates(campaignId, f) {
      await delay();
      const camp = db.campaigns.find((c) => c.id === campaignId);
      if (!camp) return fail('CAMPAIGN_NOT_FOUND');
      if ((f.tier as string) === 'VIP') return fail('VALIDATION_ERROR', { field: 'tier' });
      // Intended behaviour (requested from A): the filter uses the campaign's apply conditions.
      const qualificationIgnored = !(camp.applyConditions?.conditions.length);
      if (f.onlyQualified && !qualificationIgnored && (!f.qualifiedFrom || !f.qualifiedTo)) return fail('VALIDATION_ERROR', { field: 'qualifiedFrom' });
      // Any existing pass (even cancelled) blocks a new one: one pass per customer per campaign.
      const has = new Set(db.passes.filter((p) => p.campaign.id === campaignId).map((p) => p.customer.id));
      const q = f.search?.trim().toLowerCase();
      const inRange = (iso: string | null, from?: string, to?: string) => {
        if (!from && !to) return true;
        if (!iso) return false;
        const d = iso.slice(0, 10); // VN wall clock, no offset
        return (!from || d >= from) && (!to || d <= to);
      };
      const base = CANDIDATES.filter((c) => {
        if (q && ![c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(q))) return false;
        if (f.onlyQualified && !qualificationIgnored && c.qualifyingOrderCount === 0) return false;
        if (f.onlyQualified && !qualificationIgnored && !inRange(c.lastVisitAt, f.qualifiedFrom, f.qualifiedTo)) return false;
        if (!inRange(c.lastVisitAt, f.visitFrom, f.visitTo)) return false;
        if (f.minVisits && c.visitCount < f.minVisits) return false;
        if (f.minSpent && c.totalSpent < f.minSpent) return false;
        if (f.tier === 'NEW' && c.visitCount > 1) return false;
        if (f.tier === 'RETURNING' && c.visitCount < 2) return false;
        if (f.vipMenu === 'USED' && c.vipMenuCount === 0) return false;
        if (f.vipMenu === 'NOT_USED' && c.vipMenuCount > 0) return false;
        if (f.guestType && c.guestType !== f.guestType) return false;
        if (f.gender && c.gender !== f.gender) return false;
        if (f.nationality && c.nationality !== f.nationality) return false;
        if (f.language && c.language !== f.language) return false;
        return true;
      });
      const rows = f.hasEmail === false ? base : base.filter((c) => c.email);
      const offset = f.offset ?? 0;
      const limit = f.limit ?? BULK_ISSUE_MAX;
      return ok({
        rows: rows.slice(offset, offset + limit).map((c) => ({
          ...c,
          vipMenuUsed: c.vipMenuCount > 0,
          tier: c.visitCount <= 1 ? ('NEW' as const) : ('RETURNING' as const),
          alreadyHasPass: has.has(c.id),
        })),
        qualificationIgnored,
        total: rows.length,
        excludedNoEmail: f.hasEmail === false ? 0 : base.length - rows.length,
        nationalities: [...new Set(CANDIDATES.map((c) => c.nationality).filter((n): n is string => !!n))].sort(),
      });
    },
    async bulkIssue(campaignId, customerIds) {
      await delay();
      const c = db.campaigns.find((x) => x.id === campaignId);
      if (!c) return fail('CAMPAIGN_NOT_FOUND');
      if (c.status !== 'ACTIVE') return fail('PROMOTION_INACTIVE');
      const unique = [...new Set(customerIds)];
      if (unique.length === 0 || unique.length > BULK_ISSUE_MAX) return fail('VALIDATION_ERROR', { field: 'customerIds' });
      const results: BulkIssueItem[] = unique.map((id) => {
        const cus = CANDIDATES.find((x) => x.id === id);
        if (!cus) return { customerId: id, status: 'FAILED', errorCode: 'CUSTOMER_NOT_FOUND' };
        if (db.passes.some((p) => p.campaign.id === campaignId && p.customer.id === id)) return { customerId: id, status: 'ALREADY_EXISTS' };
        const p = issueOne(c, cus);
        return { customerId: id, status: 'ISSUED', passId: p.id, voucherCode: p.voucherCode, emailDelivery: p.emailDelivery };
      });
      const count = (fn: (r: BulkIssueItem) => boolean) => results.filter(fn).length;
      return ok({
        results,
        summary: {
          issued: count((r) => r.status === 'ISSUED'),
          alreadyExists: count((r) => r.status === 'ALREADY_EXISTS'),
          failed: count((r) => r.status === 'FAILED'),
          emailSent: count((r) => r.emailDelivery?.status === 'SENT'),
          emailFailed: count((r) => r.emailDelivery?.status === 'FAILED'),
          emailSkipped: count((r) => r.emailDelivery?.status === 'SKIPPED'),
          emailQueued: count((r) => r.emailDelivery?.status === 'QUEUED'),
        },
      });
    },

    async getPassByToken(token) {
      await delay();
      const p = db.passes.find((x) => x.qrPayload.endsWith(token.trim()));
      return p ? ok(refresh(p)) : fail('PROMOTION_NOT_FOUND');
    },
    async getPassByCode(code) {
      await delay();
      const p = db.passes.find((x) => x.voucherCode === code.trim().toUpperCase());
      return p ? ok(refresh(p)) : fail('PROMOTION_NOT_FOUND');
    },

    async getActiveOrders(passId, filter = {}) {
      await delay();
      const p = db.passes.find((x) => x.id === passId);
      if (!p) return fail('PROMOTION_NOT_FOUND');
      if (p.voucherCode === 'OCT30-NOORD0') return ok([]);
      const q = filter.search?.trim().toLowerCase();
      const rows = db.orders
        .filter((o) => !q || [o.billCode ?? '', o.customerName ?? '', o.roomLabel ?? ''].some((v) => v.toLowerCase().includes(q)))
        .map((o) => toCandidate(o, p))
        .sort((a, b) => Number(b.isPassOwnerOrder) - Number(a.isPassOwnerOrder) || (a.bookingTime ?? '').localeCompare(b.bookingTime ?? ''));
      return ok(rows);
    },
    async applyPass(passId, bookingId, override) {
      await delay();
      const p = db.passes.find((x) => x.id === passId);
      if (!p) return fail('PROMOTION_NOT_FOUND');
      const o = db.orders.find((x) => x.id === bookingId);
      if (!o) return fail('ORDER_NOT_FOUND');
      const cand = toCandidate(o, p);
      if (cand.eligibility === 'BLOCKED') return fail(cand.blockedReasonCode ?? 'ORDER_NOT_ELIGIBLE');
      const overridden = cand.eligibility === 'NOT_ELIGIBLE';
      if (overridden && !override) return fail('ORDER_CONDITION_NOT_MET', { unmetReasons: cand.unmetReasons, canOverride: true });
      const note = override?.note.trim() ?? '';
      if (overridden && (note.length < 3 || note.length > 500)) return fail('OVERRIDE_REASON_REQUIRED');

      const minutes = p.benefit.type === 'FREE_MINUTES' ? p.benefit.value : 0;
      const paid = o.items.filter((i) => !i.isPromotion).reduce((s, i) => s + i.price, 0);
      const discount = p.benefit.type === 'PERCENT_DISCOUNT' ? Math.round((paid * p.benefit.value) / 100) : p.benefit.type === 'FIXED_DISCOUNT' ? Math.min(p.benefit.value, paid) : 0;
      o.items.push({ id: `${o.id}-km-${++seq}`, serviceName: p.campaign.name, durationMinutes: minutes, price: discount ? -discount : 0, isPromotion: true });
      p.usage.usedCount += 1;
      p.lastUsedAt = new Date().toISOString();
      const cus = CANDIDATES.find((c) => c.id === o.customerId)!;
      const usage: PromotionUsageRecord = {
        id: `USG_${seq}`,
        appliedAt: p.lastUsedAt,
        status: 'APPLIED',
        benefit: p.benefit,
        appliedMinutes: minutes,
        discountAmount: discount,
        passId: p.id,
        voucherCode: p.voucherCode,
        campaignName: p.campaign.name,
        customer: refOf(cus),
        passOwner: { id: p.customer.id, name: p.customer.name },
        booking: { id: o.id, billCode: o.billCode, displayCode: o.displayCode },
        staffName: 'Bạn',
        // Overriding an eligible order is a normal apply, not an exception (v8).
        conditionsOverridden: overridden,
        overrideReasons: overridden ? cand.unmetReasons : [],
        overrideNote: overridden ? note : null,
      };
      db.usages.unshift(usage);
      return ok({ usageId: usage.id, appliedMinutes: minutes, discountAmount: discount, conditionsOverridden: overridden, overrideReasons: overridden ? cand.unmetReasons : null, booking: toBooking(o), pass: stripQr(refresh(p)) });
    },
    async cancelUsage(usageId) {
      await delay();
      const u = db.usages.find((x) => x.id === usageId);
      if (!u) return fail('USAGE_NOT_FOUND');
      if (u.status === 'COMPLETED') return fail('USAGE_COMPLETED');
      const o = db.orders.find((x) => x.id === u.booking.id);
      if (o?.status === 'IN_PROGRESS') return fail('PROMOTION_ITEM_IN_SERVICE');
      u.status = 'CANCELLED';
      if (o) o.items = o.items.filter((i) => !i.isPromotion);
      const p = db.passes.find((x) => x.id === u.passId);
      if (p) p.usage.usedCount = Math.max(0, p.usage.usedCount - 1);
      return ok({ id: u.id, status: u.status });
    },

    async getUsageHistory(filter = {}) {
      await delay();
      const q = filter.search?.trim().toLowerCase();
      return ok(
        db.usages.filter((u) => {
          if (filter.passId && u.passId !== filter.passId) return false;
          if (filter.overridden && !u.conditionsOverridden) return false;
          if (filter.status && u.status !== filter.status) return false;
          if (filter.campaignId) {
            const c = db.campaigns.find((x) => x.id === filter.campaignId);
            if (!c || u.campaignName !== c.name) return false;
          }
          const d = new Date(Date.parse(u.appliedAt) + 7 * 3600_000).toISOString().slice(0, 10);
          if (filter.dateFrom && d < filter.dateFrom) return false;
          if (filter.dateTo && d > filter.dateTo) return false;
          if (!q) return true;
          return [u.voucherCode, u.booking.billCode ?? '', u.customer.name ?? ''].some((v) => v.toLowerCase().includes(q));
        }),
      );
    },
  };
};

// Rebuild a full form from a stored campaign (to merge a partial PATCH).
const campaignFormOf = (c: PromotionCampaign): CampaignFormInput => ({
  name: c.name,
  campaignCode: c.campaignCode,
  description: c.description ?? '',
  nameI18n: c.nameI18n ?? {},
  descriptionI18n: c.descriptionI18n ?? {},
  benefitType: c.benefit.type,
  benefitValue: c.benefit.value,
  benefitConfig: c.benefit.config?.maxDiscountAmount ? { maxDiscountAmount: c.benefit.config.maxDiscountAmount } : null,
  validFrom: c.validFrom.slice(0, 10),
  validUntil: c.validUntil.slice(0, 10),
  validityType: c.validity?.type ?? 'CAMPAIGN_PERIOD',
  validityDays: c.validity?.days ?? null,
  usageType: c.usage.type,
  usageLimit: c.usage.limit,
  maxUsagePerOrder: c.usage.maxPerOrder,
  applyConditions: c.applyConditions ?? NO_CONDITIONS,
  assignmentMode: c.assignmentMode,
  voucherPrefix: c.voucherPrefix,
});

const pickRules = (c: PromotionCampaign): Partial<CampaignFormInput> => ({
  benefitType: c.benefit.type,
  benefitValue: c.benefit.value,
  usageType: c.usage.type,
  usageLimit: c.usage.limit,
  maxUsagePerOrder: c.usage.maxPerOrder,
  applyConditions: c.applyConditions ?? NO_CONDITIONS,
  validityType: c.validity?.type ?? 'CAMPAIGN_PERIOD',
  validityDays: c.validity?.days ?? null,
  validFrom: c.validFrom.slice(0, 10),
});
