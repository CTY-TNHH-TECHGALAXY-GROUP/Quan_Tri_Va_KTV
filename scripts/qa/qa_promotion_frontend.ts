/**
 * QA — Promotion frontend (Agent B), contract v2 of the Promotion Engine.
 * Runs against the MOCK adapter + the pure helpers used by the screens.
 * No DB, no network.
 *
 * Camera scanning itself (case 5 / 14) must be checked by hand on a phone;
 * here only the decode parsing and the ?t= deep link are covered.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_promotion_frontend.ts
 * Thêm: TZ=UTC để kiểm ngày hiển thị theo giờ VN khi máy chủ chạy UTC.
 */
import { createMockPromotionApi } from '../../lib/services/promotionApi.mock';
import { parseManualCode, parseScannedText } from '../../components/promotions/scan-parse';
import {
  EMPTY_CAMPAIGN_FORM,
  toCampaignPayload,
  toLockedCampaignPatch,
  validateCampaignForm,
} from '../../components/promotions/CampaignForm.logic';
import { lookupFromUrl, pickDefaultOrderId } from '../../app/admin/promotions/scan/ScanVoucher.logic';
import {
  formatBenefit,
  formatPromoDate,
  formatPromoDateTime,
  formatUsageType,
  formatUsedCount,
  orderCode,
  passBlockedCode,
  promotionErrorMessage,
} from '../../lib/promotion-format';
import { ERROR_MESSAGE, SUPPORTED_ASSIGNMENTS, t as i18n } from '../../components/promotions/promotion.i18n';
import { qualifiedRangeError } from '../../components/promotions/CustomerCandidates.logic';
import { VOUCHER_CARD_LABELS } from '../../components/promotions/voucher-card.i18n';
import { voucherCardFromCampaign, voucherCardFromPublic } from '../../components/promotions/VoucherCard3D.logic';
import { BULK_ISSUE_MAX } from '../../lib/types/promotion-client';
import type { CampaignFormInput, PromotionErrorCode, PromotionPassWithQr } from '../../lib/types/promotion-client';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
};

const unwrap = <T>(r: { success: boolean; data?: T; error?: unknown }): T => {
  if (!r.success) throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.data as T;
};

type Api = ReturnType<typeof createMockPromotionApi>;

const lookupScan = async (api: Api, text: string) => {
  const req = parseScannedText(text);
  if (!req) return { success: false as const, error: { code: 'PROMOTION_NOT_FOUND' as PromotionErrorCode, message: '' } };
  return req.kind === 'token' ? api.getPassByToken(req.value) : api.getPassByCode(req.value);
};

/** Keys the engine schema accepts on POST/PATCH (body is strict). */
const ENGINE_CAMPAIGN_KEYS = new Set([
  'campaignCode', 'name', 'description', 'validityType', 'validityDays', 'benefitType', 'benefitValue', 'benefitConfig',
  'validFrom', 'validUntil', 'usageType', 'usageLimit', 'maxUsagePerCustomer', 'maxUsagePerOrder', 'qualificationType',
  'qualificationValue', 'qualificationConfig', 'applicableMenus', 'assignmentMode', 'onePassPerCustomer', 'voucherPrefix',
  'serviceNameVN', 'serviceNameEN',
]);

const main = async () => {
  const api = createMockPromotionApi();
  console.log(`TZ=${process.env.TZ ?? '(local)'}\n`);

  console.log('1. Campaign list load');
  const campaigns = unwrap(await api.listCampaigns());
  check('lists campaigns', campaigns.length >= 3);
  const oct = campaigns.find((c) => c.id === 'CMP_OCT30')!;
  check('October +30: benefit label', formatBenefit(oct.benefit) === '+30 phút', formatBenefit(oct.benefit));
  check('October +30: usage label', formatUsageType(oct.usage) === 'Không giới hạn', formatUsageType(oct.usage));
  check('October +30: valid until 31/10/2026 (VN day)', formatPromoDate(oct.validUntil) === '31/10/2026', formatPromoDate(oct.validUntil));
  check('datetime = date then time', formatPromoDateTime('2026-10-01T18:05:00+07:00') === '01/10/2026 18:05');

  console.log('\n2. Campaign form (validation + strict payload)');
  const empty = validateCampaignForm(EMPTY_CAMPAIGN_FORM);
  check('empty form → name/code/dates required', !!(empty.name && empty.campaignCode && empty.validFrom && empty.validUntil));
  check('voucher prefix is optional', !empty.voucherPrefix);
  check('default: manual issue, no menu pre-selected', EMPTY_CAMPAIGN_FORM.assignmentMode === 'MANUAL_ONLY' && EMPTY_CAMPAIGN_FORM.applicableMenus === null);
  check('AUTO is disabled (auto issue off)', !SUPPORTED_ASSIGNMENTS.includes('AUTO'));
  const good: CampaignFormInput = { ...EMPTY_CAMPAIGN_FORM, name: 'Nov +30', campaignCode: 'NOV_FREE30_2026', voucherPrefix: 'NOV30', validFrom: '2026-11-01', validUntil: '2026-11-30' };
  check('engine-style code with _ accepted', Object.keys(validateCampaignForm(good)).length === 0, validateCampaignForm(good));
  check('code < 3 chars → error', !!validateCampaignForm({ ...good, campaignCode: 'AB' }).campaignCode);
  check('AUTO → error', !!validateCampaignForm({ ...good, assignmentMode: 'AUTO' }).assignmentMode);
  check('LIMITED without limit → error', !!validateCampaignForm({ ...good, usageType: 'LIMITED', usageLimit: null }).usageLimit);
  check('LIMITED 10 → ok', !validateCampaignForm({ ...good, usageType: 'LIMITED', usageLimit: 10 }).usageLimit);
  check('end before start → error', !!validateCampaignForm({ ...good, validUntil: '2026-10-01' }).validUntil);
  check('30.5 minutes → error', !!validateCampaignForm({ ...good, benefitValue: 30.5 }).benefitValue);
  check('percent 15 → ok (now supported)', Object.keys(validateCampaignForm({ ...good, benefitType: 'PERCENT_DISCOUNT', benefitValue: 15 })).length === 0);
  check('percent 120 → error', !!validateCampaignForm({ ...good, benefitType: 'PERCENT_DISCOUNT', benefitValue: 120 }).benefitValue);
  check('DAYS_FROM_ISSUE without days → error', !!validateCampaignForm({ ...good, validityType: 'DAYS_FROM_ISSUE' }).validityDays);
  check('DAYS_FROM_ISSUE 30 → ok', !validateCampaignForm({ ...good, validityType: 'DAYS_FROM_ISSUE', validityDays: 30 }).validityDays);
  const payload = toCampaignPayload({ ...good, benefitConfig: { maxDiscountAmount: 100000 }, validityDays: 5 });
  check('payload has only engine keys', Object.keys(payload).every((k) => ENGINE_CAMPAIGN_KEYS.has(k)), Object.keys(payload).filter((k) => !ENGINE_CAMPAIGN_KEYS.has(k)));
  check('payload drops benefitConfig for minutes, days for campaign period', payload.benefitConfig === null && payload.validityDays === null);
  check('payload: empty menus → null (all menus)', toCampaignPayload({ ...good, applicableMenus: { menus: [] } }).applicableMenus === null);
  check('locked patch = name/description/validUntil only', Object.keys(toLockedCampaignPatch(good)).sort().join() === 'description,name,validUntil');
  const created = await api.createCampaign(toCampaignPayload({ ...good, usageType: 'LIMITED', usageLimit: 10 }));
  check('create LIMITED 10 → "Giới hạn 10 lần"', created.success && formatUsageType(created.data.usage) === 'Giới hạn 10 lần');
  const dupCode = await api.createCampaign(toCampaignPayload(good));
  check('duplicate code → CAMPAIGN_CODE_EXISTS', !dupCode.success && dupCode.error.code === 'CAMPAIGN_CODE_EXISTS');
  const lockedRule = await api.updateCampaign('CMP_OCT30', { usageType: 'LIMITED', usageLimit: 5 });
  check('active campaign rule change → CAMPAIGN_LOCKED', !lockedRule.success && lockedRule.error.code === 'CAMPAIGN_LOCKED');
  const lockedOk = await api.updateCampaign('CMP_OCT30', { name: 'October +30 Minutes (VIP)', description: 'x', validUntil: '2026-10-31' });
  check('active campaign: name/desc/end date editable', lockedOk.success && lockedOk.data.name.endsWith('(VIP)'));
  check('menus catalogue loads', unwrap(await api.getMenus()).some((m) => m.code === 'NHP'));

  console.log('\n3–4. Customer pass list + search + paging');
  const page1 = unwrap(await api.getPasses({ limit: 50 }));
  check('pass list loads with total', page1.rows.length >= 6 && page1.total === page1.rows.length);
  check('list rows never carry qrPayload', page1.rows.every((p) => !('qrPayload' in p)));
  check('rows carry effectiveStatus', page1.rows.every((p) => !!p.effectiveStatus));
  const paged = unwrap(await api.getPasses({ limit: 2, offset: 2 }));
  check('limit/offset paging', paged.rows.length === 2 && paged.total >= 6);
  for (const [q, expect] of [['charlotte', 'OCT30-X7K92A'], ['0901234567', 'OCT30-X7K92A'], ['minh@example.com', 'OCT30-MULTI2'], ['ten10-lim', 'TEN10-LIM009']] as const) {
    check(`search "${q}" finds ${expect}`, unwrap(await api.getPasses({ search: q })).rows.some((p) => p.voucherCode === expect));
  }
  check('filter effective EXPIRED', unwrap(await api.getPasses({ status: 'EXPIRED' })).rows.every((p) => p.effectiveStatus === 'EXPIRED'));

  console.log('\n— Tracking tabs (engine v5 group)');
  const activeTab = unwrap(await api.getPasses({ group: 'ACTIVE' }));
  const pastTab = unwrap(await api.getPasses({ group: 'PAST' }));
  check('ACTIVE tab: usable or re-openable only', activeTab.rows.every((p) => !['EXPIRED', 'USED_UP', 'CANCELLED'].includes(p.effectiveStatus)));
  check('PAST tab: expired / used up / cancelled, with endedAt', pastTab.rows.length > 0 && pastTab.rows.every((p) => ['EXPIRED', 'USED_UP', 'CANCELLED'].includes(p.effectiveStatus) && !!p.endedAt));
  check('ACTIVE sorted soonest expiry first', activeTab.rows.every((p, i, a) => i === 0 || a[i - 1].validUntil <= p.validUntil));
  const ov = unwrap(await api.getOverview());
  check('overview counts = tab totals', ov.activePasses === activeTab.total && ov.pastPasses === pastTab.total, ov);
  check('expiring-7d chip combines with ACTIVE', unwrap(await api.getPasses({ group: 'ACTIVE', expiry: 'EXPIRING_7D' })).rows.every((p) => Date.parse(p.validUntil) <= Date.now() + 7 * 86400_000));

  console.log('\n5. Scan valid QR (URL from e-voucher, token, code) + deep link');
  const qrUrl = unwrap(await api.getPass('PASS_001')).qrPayload;
  const byUrl = await lookupScan(api, qrUrl);
  check('QR payload is an URL with ?t=', /\?t=/.test(qrUrl), qrUrl);
  check('URL lookup → PASS_001', byUrl.success && byUrl.data.id === 'PASS_001');
  const byCode = await lookupScan(api, ' oct30-x7k92a ');
  check('code lookup (trim/upper)', byCode.success && byCode.data.voucherCode === 'OCT30-X7K92A');
  const deep = lookupFromUrl(new URL(qrUrl).searchParams);
  check('phone camera opens …?t= → scanner looks up token', deep?.kind === 'token' && qrUrl.endsWith(deep.value));
  check('…?code=oct30-x7k92a → code lookup', lookupFromUrl(new URLSearchParams('code=oct30-x7k92a'))?.value === 'OCT30-X7K92A');
  check('no params → no auto lookup', lookupFromUrl(new URLSearchParams('')) === null);
  const scanned = (byUrl as { data: PromotionPassWithQr }).data;
  check('scan card: used 4 times', formatUsedCount(scanned.usage) === '4 lần');
  check('scan does NOT consume the pass', unwrap(await api.getPass('PASS_001')).usage.usedCount === 4);

  console.log('\n6. Scan invalid QR');
  const bad = await lookupScan(api, 'random-garbage');
  check('unknown token → PROMOTION_NOT_FOUND', !bad.success && bad.error.code === 'PROMOTION_NOT_FOUND');
  check('URL without token → rejected', parseScannedText('https://evil.example/x') === null);
  check('not-found message', promotionErrorMessage('PROMOTION_NOT_FOUND') === 'Không tìm thấy voucher.');

  console.log('\n7. Scan expired / inactive QR');
  const exp = unwrap(await api.getPassByCode('SEP30-EXP001'));
  check('expired → effectiveStatus EXPIRED', exp.effectiveStatus === 'EXPIRED');
  check('blocked code for EXPIRED', passBlockedCode(exp.effectiveStatus) === 'PROMOTION_EXPIRED');
  const expApply = await api.applyPass(exp.id, 'BK_1028');
  check('apply expired → PROMOTION_EXPIRED', !expApply.success && expApply.error.code === 'PROMOTION_EXPIRED');
  await api.setCampaignStatus('CMP_TEN10', 'DEACTIVATE');
  check('campaign paused → pass INACTIVE', unwrap(await api.getPass('PASS_006')).effectiveStatus === 'INACTIVE');
  await api.setCampaignStatus('CMP_TEN10', 'ACTIVATE');

  console.log('\n8. Owner has ONE open order among all open orders (shared voucher)');
  const o1 = unwrap(await api.getActiveOrders('PASS_001'));
  check('owner order first, shows bill code', o1[0].isPassOwnerOrder && /^NH-\d{6}-028$/.test(orderCode(o1[0])), orderCode(o1[0]));
  check('booking time is server "HH:mm"', o1[0].bookingTime === '14:30');
  check("friends' open orders listed too", o1.some((o) => !o.isPassOwnerOrder));
  check('owner order auto-selected', pickDefaultOrderId(o1, null) === 'BK_1028');
  const friendsOnly = o1.filter((o) => !o.isPassOwnerOrder);
  check('no owner order, several → no auto-select', pickDefaultOrderId(friendsOnly, null) === null);
  check('no owner order, exactly one → auto-select', pickDefaultOrderId(friendsOnly.slice(0, 1), null) === friendsOnly[0].id);

  console.log('\n9. Owner has MULTIPLE open orders');
  const o2 = unwrap(await api.getActiveOrders('PASS_002'));
  check('2 owner orders → no auto-select', o2.filter((o) => o.isPassOwnerOrder).length === 2 && pickDefaultOrderId(o2, null) === null);
  check('keeps staff choice', pickDefaultOrderId(o2, 'BK_1032') === 'BK_1032');
  check('order search by bill code', unwrap(await api.getActiveOrders('PASS_002', { search: '035' })).length === 1);

  console.log('\n10. No open orders');
  check('empty list', unwrap(await api.getActiveOrders('PASS_003')).length === 0);

  console.log('\n11. Apply success');
  const applied = await api.applyPass('PASS_001', 'BK_1028');
  check('apply ok', applied.success);
  if (applied.success) {
    check('order has KM line 0 VND, 30 min', applied.data.booking.items.some((i) => i.isPromotion && i.price === 0 && i.durationMinutes === 30));
    check('total duration from server = 120', applied.data.booking.totalDurationMinutes === 120);
    check('used count 4 → 5', applied.data.pass.usage.usedCount === 5);
    check('success shows bill code', /^NH-/.test(orderCode(applied.data.booking)));
  }

  console.log('\n12. Apply duplicate');
  const dup = await api.applyPass('PASS_001', 'BK_1028');
  check('again → PROMOTION_ALREADY_APPLIED', !dup.success && dup.error.code === 'PROMOTION_ALREADY_APPLIED');
  check('order card disabled with reason', unwrap(await api.getActiveOrders('PASS_001')).find((o) => o.id === 'BK_1028')?.blockedReasonCode === 'PROMOTION_ALREADY_APPLIED');

  console.log("\n13. Friend's order (voucher shared)");
  const friend = await api.applyPass('PASS_001', 'BK_1035');
  check("friend's order accepted", friend.success);
  const hist0 = unwrap(await api.getUsageHistory({ passId: 'PASS_001' }));
  const friendUse = hist0.find((u) => u.booking.id === 'BK_1035');
  check('usage records order customer + voucher owner', friendUse?.customer.name === 'Lan Pham' && friendUse?.passOwner?.name === 'Charlotte Nguyen');

  console.log('\n— Discount vouchers');
  const pct = unwrap(await api.createCampaign(toCampaignPayload({ ...good, campaignCode: 'PCT15', name: '-15%', benefitType: 'PERCENT_DISCOUNT', benefitValue: 15 })));
  check('percent campaign label', formatBenefit(pct.benefit) === '-15%');

  console.log('\n— Cancel a mistaken apply');
  const appliedUsage = hist0.find((u) => u.booking.id === 'BK_1028' && u.status === 'APPLIED')!;
  const cancelOk = await api.cancelUsage(appliedUsage.id);
  check('cancel APPLIED usage (not dispatched) → ok', cancelOk.success);
  check('KM line removed, order applicable again', unwrap(await api.getActiveOrders('PASS_001')).find((o) => o.id === 'BK_1028')?.canApply === true);
  const cancelBusy = await api.cancelUsage(friendUse!.id);
  check('cancel while KM in service → PROMOTION_ITEM_IN_SERVICE', !cancelBusy.success && cancelBusy.error.code === 'PROMOTION_ITEM_IN_SERVICE');
  const cancelDone = await api.cancelUsage('USG_001');
  check('cancel completed usage → USAGE_COMPLETED', !cancelDone.success && cancelDone.error.code === 'USAGE_COMPLETED');

  console.log('\n— LIMITED 10 voucher');
  const lim1 = await api.applyPass('PASS_006', 'BK_1031');
  check('9/10 → 10th ok, label 10/10', lim1.success && formatUsedCount(lim1.data.pass.usage) === '10/10 lần');
  const lim2 = await api.applyPass('PASS_006', 'BK_1032');
  check('11th → PROMOTION_USED_UP', !lim2.success && lim2.error.code === 'PROMOTION_USED_UP');
  check('10/10 → effective USED_UP, moves to PAST', unwrap(await api.getPass('PASS_006')).effectiveStatus === 'USED_UP' && unwrap(await api.getPasses({ group: 'PAST' })).rows.some((p) => p.id === 'PASS_006'));
  check('USED_UP message', promotionErrorMessage('PROMOTION_USED_UP') === 'Voucher đã dùng hết lượt.');

  console.log('\n14–15. Camera denied → manual fallback (manual: check on a phone)');
  check('manual accepts code', parseManualCode('oct30-x7k92a')?.value === 'OCT30-X7K92A');
  check('manual rejects free text / token', parseManualCode('hello') === null && parseManualCode('mock-qr-token-PASS_001') === null);

  console.log('\n— Customer profile filter (issue to the right customers)');
  const all = unwrap(await api.getCustomerCandidates('CMP_OCT30', { hasEmail: true }));
  check('page size ≤ 50', all.rows.length <= BULK_ISSUE_MAX && all.total > BULK_ISSUE_MAX, { rows: all.rows.length, total: all.total });
  const holders = all.rows.filter((c) => c.alreadyHasPass).map((c) => c.id);
  check('existing pass holders flagged alreadyHasPass', ['CUS001', 'CUS002', 'CUS004'].every((id) => holders.includes(id)), holders);
  check('lastVisitAt without offset shown as VN day', formatPromoDate('2026-10-01T23:30:00') === '01/10/2026' && formatPromoDateTime('2026-10-01T23:30:00') === '01/10/2026 23:30');
  check('no-email customers excluded + counted', all.rows.every((c) => !!c.email) && all.excludedNoEmail > 0);
  const withNoEmail = unwrap(await api.getCustomerCandidates('CMP_OCT30', { hasEmail: false }));
  check('hasEmail off → includes no-email profiles', withNoEmail.total > all.total);
  const vipTier = await api.getCustomerCandidates('CMP_TEN10', { tier: 'VIP' as never });
  check('tier VIP no longer exists → VALIDATION_ERROR', !vipTier.success && vipTier.error.code === 'VALIDATION_ERROR');
  const returning = unwrap(await api.getCustomerCandidates('CMP_TEN10', { tier: 'RETURNING', vipMenu: 'USED' }));
  check('tier RETURNING + vipMenu USED', returning.rows.length > 0 && returning.rows.every((c) => c.visitCount >= 2 && c.vipMenuCount > 0));
  const noDates = await api.getCustomerCandidates('CMP_OCT30', { onlyQualified: true });
  check('onlyQualified without dates → VALIDATION_ERROR', !noDates.success && noDates.error.code === 'VALIDATION_ERROR');
  check('client blocks missing / > 93-day range', qualifiedRangeError({ onlyQualified: true }) && qualifiedRangeError({ onlyQualified: true, qualifiedFrom: '2026-01-01', qualifiedTo: '2026-06-01' }) && !qualifiedRangeError({ onlyQualified: true, qualifiedFrom: '2026-09-01', qualifiedTo: '2026-10-02' }));
  const qual = unwrap(await api.getCustomerCandidates('CMP_OCT30', { onlyQualified: true, qualifiedFrom: '2026-09-01', qualifiedTo: '2026-10-02', gender: 'FEMALE', vipMenu: 'USED' }));
  check('qualified + gender + VIP menu combine', qual.rows.length > 0 && qual.rows.every((c) => c.qualifyingOrderCount > 0 && c.gender === 'FEMALE' && c.vipMenuCount > 0));
  const manualCmp = unwrap(await api.getCustomerCandidates('CMP_TEN10', { onlyQualified: true }));
  check('manual campaign → qualificationIgnored', manualCmp.qualificationIgnored === true);
  const spent = unwrap(await api.getCustomerCandidates('CMP_TEN10', { minSpent: 5_000_000, minVisits: 5 }));
  check('min spent + min visits', spent.rows.every((c) => c.totalSpent >= 5_000_000 && c.visitCount >= 5));
  const jp = unwrap(await api.getCustomerCandidates('CMP_TEN10', { nationality: 'Nhật Bản', language: 'jp' }));
  check('nationality + language', jp.rows.length === 1 && jp.rows[0].name === 'Kenji Sato');
  check('nationality options returned', all.nationalities.includes('Việt Nam'));
  const page2 = unwrap(await api.getCustomerCandidates('CMP_OCT30', { offset: 50, limit: 50 }));
  check('second page', page2.rows.length === all.total - 50);

  console.log('\n— Bulk issue');
  const ids = all.rows.filter((c) => !c.alreadyHasPass).slice(0, 3).map((c) => c.id);
  const bulk = unwrap(await api.bulkIssue('CMP_OCT30', ids));
  check('3 issued with email', bulk.summary.issued === 3 && bulk.summary.emailSent === 3);
  const after = unwrap(await api.getCustomerCandidates('CMP_OCT30', { hasEmail: true })).rows;
  check('issued customers now flagged alreadyHasPass', ids.every((id) => after.find((c) => c.id === id)?.alreadyHasPass));
  check('duplicate ids de-duplicated', unwrap(await api.bulkIssue('CMP_OCT30', [ids[0], ids[0]])).results.length === 1);
  check('QUEUED shown as "đang chờ gửi"', i18n.assign.bulkEmail({ emailSent: 1, emailFailed: 0, emailSkipped: 0, emailQueued: 2 }).includes('đang chờ gửi 2'));
  await api.setCampaignStatus('CMP_TEN10', 'DEACTIVATE');
  const paused = await api.bulkIssue('CMP_TEN10', ['CUS003']);
  check('bulk on paused campaign → PROMOTION_INACTIVE', !paused.success && paused.error.code === 'PROMOTION_INACTIVE');
  await api.setCampaignStatus('CMP_TEN10', 'ACTIVATE');
  const again = unwrap(await api.bulkIssue('CMP_OCT30', ids));
  check('re-issue → ALREADY_EXISTS', again.summary.alreadyExists === 3 && again.summary.issued === 0);
  const tooMany = await api.bulkIssue('CMP_OCT30', Array.from({ length: BULK_ISSUE_MAX + 1 }, (_, i) => `X${i}`));
  check(`> ${BULK_ISSUE_MAX} → VALIDATION_ERROR`, !tooMany.success && tooMany.error.code === 'VALIDATION_ERROR');

  console.log('\n— Manual issue + email');
  const single = await api.issuePass('CMP_TEN10', 'CUS005');
  check('no email on profile → issued, email SKIPPED', single.success && single.data.emailDelivery?.status === 'SKIPPED');
  const resendNoEmail = await api.sendPassEmail((single as { data: PromotionPassWithQr }).data.id);
  check('resend without email → CUSTOMER_NO_EMAIL', !resendNoEmail.success && resendNoEmail.error.code === 'CUSTOMER_NO_EMAIL');
  const resend = await api.sendPassEmail('PASS_002');
  check('resend failed email → SENT', resend.success && resend.data.emailStatus === 'SENT');
  const issueAgain = await api.issuePass('CMP_TEN10', 'CUS005');
  check('issue again → PASS_ALREADY_EXISTS with pass', !issueAgain.success && issueAgain.error.code === 'PASS_ALREADY_EXISTS' && !!issueAgain.error.data);

  console.log('\n19–21. View QR / usage history / past');
  check('19. QR payload comes from server', unwrap(await api.getPass('PASS_001')).qrPayload.includes('mock-qr-token-PASS_001'));
  const hist = unwrap(await api.getUsageHistory({ passId: 'PASS_001' }));
  check('20. usage history newest first', hist[0].appliedAt >= hist[hist.length - 1].appliedAt);
  check('21. expired pass effective EXPIRED (→ Past)', unwrap(await api.getPass('PASS_004')).effectiveStatus === 'EXPIRED');

  console.log('\n— Public e-voucher page (/voucher) card');
  const pub = voucherCardFromPublic({
    campaignName: 'October +30 Minutes', benefit: { type: 'FREE_MINUTES', value: 30 },
    usage: { type: 'LIMITED', limit: 10, maxPerOrder: 1, usedCount: 10 }, validFrom: '2026-10-01T00:00:00+07:00', validUntil: '2026-10-31T23:59:59+07:00',
    voucherCode: 'OCT30-X7K92A', voucherPrefix: 'OCT30', customerName: 'Charlotte', effectiveStatus: 'USED_UP',
    applicableMenus: { menus: ['NHP'], categories: [], serviceIds: [], allMenus: false }, qrPayload: null,
  });
  check('public DTO → card (status from effectiveStatus, no QR when unusable)', pub.status === 'USED_UP' && pub.qrPayload === null && !pub.isTemplate);
  check('card text in 5 languages', VOUCHER_CARD_LABELS.vi.benefit({ type: 'FREE_MINUTES', value: 30 }) === '+30 phút' && VOUCHER_CARD_LABELS.en.benefit({ type: 'FREE_MINUTES', value: 30 }) === '+30 min' && VOUCHER_CARD_LABELS.jp.usage({ type: 'UNLIMITED', limit: null, maxPerOrder: 1 }) === '回数無制限' && VOUCHER_CARD_LABELS.kr.status.USED_UP === '사용 완료' && VOUCHER_CARD_LABELS.cn.voucherCode === '券码');
  check('every language has every status', Object.values(VOUCHER_CARD_LABELS).every((l) => ['ACTIVE', 'NOT_STARTED', 'INACTIVE', 'EXPIRED', 'USED_UP', 'SUSPENDED', 'CANCELLED'].every((s) => !!l.status[s as keyof typeof l.status])));

  console.log('\n— Condition line on the e-voucher');
  check('vi: "Dành cho Menu VIP từ 90 phút trở lên"', VOUCHER_CARD_LABELS.vi.condition(['Menu VIP'], 90) === 'Dành cho Menu VIP từ 90 phút trở lên');
  check('vi: menu only / minutes only', VOUCHER_CARD_LABELS.vi.condition(['Menu VIP'], null) === 'Dành cho Menu VIP' && VOUCHER_CARD_LABELS.vi.condition([], 90) === 'Dành cho mọi dịch vụ từ 90 phút trở lên');
  check('en / jp condition', VOUCHER_CARD_LABELS.en.condition(['VIP Menu'], 90) === 'For VIP Menu, 90+ min' && VOUCHER_CARD_LABELS.jp.condition(['VIP'], 90) === 'VIP（90分以上）対象');
  const tpl = voucherCardFromCampaign(unwrap(await api.getCampaign('CMP_OCT30')), (code) => (code === 'NHP' ? 'Menu VIP' : code));
  check('campaign template: menu label + 90 min', tpl.conditions?.menuLabels.join() === 'Menu VIP' && tpl.conditions?.minPaidMinutes === 90);
  check('issued pass carries conditions', unwrap(await api.getPass('PASS_001')).conditions?.minPaidMinutes === 90);
  check('manual campaign (no rule, all menus) → no condition line', (() => { const c = voucherCardFromCampaign(campaigns.find((x) => x.id === 'CMP_TEN10')!).conditions; return !!c && c.menuLabels.length === 0 && c.minPaidMinutes === null; })());

  console.log('\n— Every error code has a staff message');
  const codes: PromotionErrorCode[] = ['CAMPAIGN_LOCKED', 'CUSTOMER_NO_EMAIL', 'EMAIL_SEND_FAILED', 'ACCOUNT_LOCKED', 'INTERNAL_ERROR', 'USAGE_COMPLETED', 'PROMOTION_ITEM_IN_SERVICE'];
  check('new codes mapped', codes.every((c) => !!ERROR_MESSAGE[c]));
  check('unknown code → generic text (no raw server error)', promotionErrorMessage('SOMETHING_NEW') === ERROR_MESSAGE.UNKNOWN);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
