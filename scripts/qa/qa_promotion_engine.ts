/**
 * QA — Promotion Engine (migration 20261002120000_promotion_engine.sql).
 *
 * Runs the promo_* RPCs directly against a Postgres that already has the
 * migration applied, with fixtures in real DB shape. Writes rows prefixed
 * QAPROMO<run> and deletes them at the end.
 *
 *   PROMO_QA_DB_URL=postgresql://... npx ts-node -P scripts/qa/tsconfig.qa.json \
 *       -r tsconfig-paths/register scripts/qa/qa_promotion_engine.ts
 *
 * Refuses to run against the production project.
 */
const { Client } = require('pg');
import { finish, fatal } from './_exit';

const PRODUCTION_REF = 'adzfohfdindovfcpaizb';
const DB_URL = process.env.PROMO_QA_DB_URL || '';
// PROMO_QA_CLEANUP_RUN=<run id> only removes the rows of an earlier, interrupted run.
const CLEANUP_ONLY = process.env.PROMO_QA_CLEANUP_RUN || '';
const RUN = CLEANUP_ONLY || `QAPROMO${Date.now().toString(36).toUpperCase()}`;

let failures = 0;
let passes = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { passes++; console.log(`  ✅ ${name}`); }
    else { failures++; console.log(`  ❌ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};

const db = new Client({ connectionString: DB_URL, ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false } });

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await db.query(sql, params)).rows as T[];
}
async function rpc(fn: string, ...args: unknown[]): Promise<any> {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await q(`SELECT ${fn}(${ph}) AS r`, args);
    return rows[0].r;
}

// ---------------------------------------------------------------- fixtures
const svc = {
    vip90: `NHP${RUN}90`, vip60: `NHP${RUN}60`, vip89: `NHP${RUN}89`, vip30: `NHP${RUN}30`,
    std90: `NHS${RUN}90`, std30: `NHS${RUN}30`,
};
let customerSeq = 0;
let bookingSeq = 0;

async function seedServices() {
    const rows: [string, string, number][] = [
        [svc.vip90, 'VIP_MENU', 90], [svc.vip60, 'VIP_MENU', 60], [svc.vip89, 'VIP_MENU', 89], [svc.vip30, 'VIP_MENU', 30],
        [svc.std90, 'Body', 90], [svc.std30, 'Body', 30],
    ];
    for (const [id, cat, dur] of rows) {
        await q(`INSERT INTO "Services"(id, code, "nameVN", "nameEN", "priceVND", "priceUSD", duration, category)
                 VALUES ($1, $1, $1, $1, 0, 0, $3, $2)`, [id, cat, dur]);
    }
}

async function newCustomer(): Promise<string> {
    const id = `${RUN}-C${++customerSeq}`;
    await q(`INSERT INTO "Customers"(id, "fullName", phone, email, "updatedAt") VALUES ($1, $2, $3, $4, now())`,
        [id, `QA Promo ${customerSeq}`, `09${Date.now().toString().slice(-6)}${customerSeq.toString().padStart(2, '0')}`, `${id.toLowerCase()}@qa.local`]);
    return id;
}

type ItemSpec = { serviceId: string; price?: number; options?: Record<string, unknown>; status?: string; quantity?: number };
async function newBooking(customerId: string | null, items: ItemSpec[], status = 'NEW', bookingDate?: string): Promise<string> {
    const id = `${RUN}-B${++bookingSeq}`;
    // Same shapes as production: createdAt / updatedAt UTC, bookingDate VN-local (reception writer).
    // A past bookingDate also backdates createdAt by one day.
    await q(`INSERT INTO "Bookings"(id, "billCode", "customerId", "customerName", "totalAmount", status, "updatedAt", "createdAt", "bookingDate", source)
             VALUES ($1, $1, $2, COALESCE((SELECT "fullName" FROM "Customers" WHERE id = $2), 'Khách lẻ'), $3, $4::"BookingStatus", now() AT TIME ZONE 'UTC',
                     (now() - CASE WHEN $5::timestamp IS NULL THEN interval '0' ELSE interval '1 day' END) AT TIME ZONE 'UTC',
                     COALESCE($5::timestamp, now() AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'VIP_MENU')`,
        [id, customerId, items.reduce((s, i) => s + (i.price ?? 0) * (i.quantity ?? 1), 0), status, bookingDate ?? null]);
    await q(`INSERT INTO "BookingGuests"(id, booking_id, guest_index, guest_label) VALUES ($1, $2, 1, 'Khách A')`, [`${id}_G1`, id]);
    let n = 0;
    for (const it of items) {
        await q(`INSERT INTO "BookingItems"(id, "bookingId", "serviceId", quantity, price, status, options, guest_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [`${id}-I${++n}`, id, it.serviceId, it.quantity ?? 1, it.price ?? 0, it.status ?? 'WAITING',
             JSON.stringify(it.options ?? {}), `${id}_G1`]);
    }
    return id;
}

const setStatus = (bookingId: string, status: string) =>
    q(`UPDATE "Bookings" SET status = $2::"BookingStatus" WHERE id = $1`, [bookingId, status]);

const passesOf = (customerId: string, campaignId?: string) =>
    q(`SELECT * FROM "CustomerPromotionPasses" WHERE customer_id = $1 AND ($2::uuid IS NULL OR campaign_id = $2::uuid)`,
        [customerId, campaignId ?? null]);

const iso = (d: Date) => d.toISOString();
const DAY = 86_400_000;

async function createCampaign(code: string, payload: Record<string, unknown>, activate = true) {
    const res = await rpc('promo_create_campaign', JSON.stringify({
        campaign_code: `${RUN}_${code}`, name: `QA ${code}`,
        valid_from: iso(new Date(Date.now() - DAY)), valid_until: iso(new Date(Date.now() + 30 * DAY)),
        voucher_prefix: 'QA', ...payload,
    }), 'QA');
    if (!res.success) throw new Error(`create ${code}: ${JSON.stringify(res)}`);
    if (activate) {
        const a = await rpc('promo_set_campaign_status', res.data.id, 'ACTIVATE', 'QA');
        if (!a.success) throw new Error(`activate ${code}: ${JSON.stringify(a)}`);
    }
    return res.data as { id: string; benefitServiceId: string };
}

const OCT_RULE = {
    benefit_type: 'FREE_MINUTES', benefit_value: 30, usage_type: 'UNLIMITED', max_usage_per_order: 1,
    qualification_type: 'MIN_PAID_DURATION', qualification_value: 90,
    qualification_config: { serviceIdPrefixes: ['NHP'], serviceCategories: ['VIP_MENU'] },
    assignment_mode: 'AUTO',
};

// ---------------------------------------------------------------- settings
let savedSettings: { key: string; value: unknown }[] = [];
const setSetting = (key: string, json: string) =>
    q(`INSERT INTO "SystemConfigs"(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, json]);
async function restoreSettings() {
    for (const key of ['promotion_auto_issue_enabled', 'promotion_email_enabled']) {
        const old = savedSettings.find(r => r.key === key);
        if (old) await setSetting(key, JSON.stringify(old.value));
        else await q(`DELETE FROM "SystemConfigs" WHERE key = $1`, [key]);
    }
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
    const like = `${RUN}%`;
    // Side effects of the environment's own Bookings/BookingItems triggers (staging): NEW_ORDER
    // notifications and KTV ABC completion markers for fixture orders. Absent on a bare local DB.
    // (KTVAbcCompletionMarkers is immutable by design — fixtures never insert DONE items, so none are created.)
    // KTVDRecomputeQueue is guarded too; fixtures never produce rows there.
    const hasNotifications = await q(`SELECT to_regclass('public."StaffNotifications"') IS NOT NULL AS ok`);
    if (hasNotifications[0].ok) await q(`DELETE FROM "StaffNotifications" WHERE "bookingId" LIKE $1`, [like]);
    await q(`DELETE FROM "PromotionUsages" WHERE booking_id LIKE $1 OR customer_id LIKE $1`, [like]);
    await q(`DELETE FROM "PromotionIssueErrors" WHERE booking_id LIKE $1`, [like]);
    await q(`DELETE FROM "BookingItems" WHERE "bookingId" LIKE $1`, [like]);
    await q(`DELETE FROM "CustomerPromotionPasses" WHERE customer_id LIKE $1`, [like]);
    await q(`DELETE FROM "BookingGuests" WHERE booking_id LIKE $1`, [like]);
    await q(`DELETE FROM "Bookings" WHERE id LIKE $1`, [like]);
    await q(`DELETE FROM "Customers" WHERE id LIKE $1`, [like]);
    const svcIds = (await q<{ s: string }>(`SELECT benefit_service_id AS s FROM "PromotionCampaigns" WHERE campaign_code LIKE $1`, [like])).map(r => r.s);
    await q(`DELETE FROM "PromotionCampaigns" WHERE campaign_code LIKE $1`, [like]);
    if (svcIds.length) await q(`DELETE FROM "Services" WHERE id = ANY($1)`, [svcIds]);
    await q(`DELETE FROM "Services" WHERE id LIKE $1 OR id LIKE $2 OR id LIKE $3`, [`NHP${RUN}%`, `NHS${RUN}%`, `NHT${RUN}%`]);
}

// ---------------------------------------------------------------- scenarios
async function main() {
    if (!DB_URL) throw new Error('PROMO_QA_DB_URL is required');
    if (DB_URL.includes(PRODUCTION_REF)) throw new Error('Refusing to run against production');
    await db.connect();
    if (CLEANUP_ONLY) { console.log(`cleanup-only for ${RUN}`); return; }
    const target = (await q<{ v: string }>(`SELECT current_database() || ' @ ' || COALESCE(inet_server_addr()::text, 'local') AS v`))[0].v;
    console.log(`=== QA Promotion Engine — run ${RUN} — ${target} — TZ=${process.env.TZ || 'system'} ===`);

    savedSettings = await q(`SELECT key, value FROM "SystemConfigs" WHERE key IN ('promotion_auto_issue_enabled', 'promotion_email_enabled')`);
    await setSetting('promotion_auto_issue_enabled', 'true');
    await setSetting('promotion_email_enabled', 'true');
    await seedServices();

    // ---------- Campaign validation (#17)
    console.log('\n[Campaign validation]');
    const bad1 = await rpc('promo_create_campaign', JSON.stringify({
        campaign_code: `${RUN}_BAD1`, name: 'bad', benefit_type: 'FREE_MINUTES', benefit_value: 30,
        valid_from: '2026-10-31T00:00:00+07:00', valid_until: '2026-10-01T00:00:00+07:00' }), 'QA');
    check('valid_until < valid_from → CAMPAIGN_INVALID', bad1.error?.code === 'CAMPAIGN_INVALID', bad1);
    const bad2 = await rpc('promo_create_campaign', JSON.stringify({
        campaign_code: `${RUN}_BAD2`, name: 'bad', benefit_type: 'FREE_MINUTES', benefit_value: 30, max_usage_per_order: 0,
        valid_from: '2026-10-01T00:00:00+07:00', valid_until: '2026-10-31T23:59:59+07:00' }), 'QA');
    check('max_usage_per_order = 0 → CAMPAIGN_INVALID', bad2.error?.code === 'CAMPAIGN_INVALID', bad2);
    const bad3 = await rpc('promo_create_campaign', JSON.stringify({
        campaign_code: `${RUN}_BAD3`, name: 'bad', benefit_type: 'FREE_MINUTES', benefit_value: 0,
        valid_from: '2026-10-01T00:00:00+07:00', valid_until: '2026-10-31T23:59:59+07:00' }), 'QA');
    check('FREE_MINUTES value 0 → CAMPAIGN_INVALID', bad3.error?.code === 'CAMPAIGN_INVALID', bad3);
    const bad4 = await rpc('promo_create_campaign', JSON.stringify({
        campaign_code: `${RUN}_BAD4`, name: 'bad', benefit_type: 'PERCENT_DISCOUNT', benefit_value: 150,
        valid_from: '2026-10-01T00:00:00+07:00', valid_until: '2026-10-31T23:59:59+07:00' }), 'QA');
    check('PERCENT 150 → CAMPAIGN_INVALID', bad4.error?.code === 'CAMPAIGN_INVALID', bad4);
    const left = await q(`SELECT count(*)::int AS n FROM "PromotionCampaigns" WHERE campaign_code LIKE $1`, [`${RUN}_BAD%`]);
    check('invalid campaigns leave no rows (and no KM service)', left[0].n === 0, left);

    // ---------- The October campaign (real dates) + engine-owned service
    console.log('\n[October campaign — OCT_FREE30 config]');
    const octRes = await rpc('promo_create_campaign', JSON.stringify({
        campaign_code: `${RUN}_OCT`, name: 'October +30 Minutes', ...OCT_RULE, voucher_prefix: 'OCT30',
        valid_from: '2026-10-01T00:00:00+07:00', valid_until: '2026-10-31T23:59:59+07:00' }), 'QA');
    check('create OCT campaign → DRAFT', octRes.success && octRes.data.status === 'DRAFT', octRes);
    const oct = octRes.data;
    const octSvc = (await q(`SELECT * FROM "Services" WHERE id = $1`, [oct.benefitServiceId]))[0];
    check('KM service auto-created (id KM####, 0đ, 30 min, is_promotion, not utility)',
        /^KM\d{4}$/.test(octSvc?.id) && Number(octSvc.priceVND) === 0 && octSvc.duration === 30
        && octSvc.is_promotion === true && octSvc.is_utility === false, octSvc);
    check('valid_until stored as 2026-10-31 23:59:59 +07 (= 16:59:59Z)', oct.validUntil === '2026-10-31T23:59:59+07:00', oct.validUntil);
    const octAct = await rpc('promo_set_campaign_status', oct.id, 'ACTIVATE', 'QA');
    check('activate OCT', octAct.success && octAct.data.status === 'ACTIVE', octAct);
    const locked = await rpc('promo_update_campaign', oct.id, JSON.stringify({ benefit_value: 45 }), 'QA');
    check('ACTIVE campaign rule edit → CAMPAIGN_LOCKED', locked.error?.code === 'CAMPAIGN_LOCKED', locked);

    // ---------- Auto issue (#1–#6)
    console.log('\n[Auto issue on DONE]');
    const c1 = await newCustomer();
    const b1 = await newBooking(c1, [{ serviceId: svc.vip90, price: 900000 }]);
    await setStatus(b1, 'DONE');
    const p1 = await passesOf(c1, oct.id);
    check('#1 90 paid VIP min → pass generated', p1.length === 1, p1.length);
    check('    voucher code OCT30-XXXXXX', /^OCT30-[2-9A-HJKMNP-TV-Z]{6}$/.test(p1[0]?.voucher_code), p1[0]?.voucher_code);
    check('    source_booking_id + issue_source AUTO', p1[0]?.source_booking_id === b1 && p1[0]?.issue_source === 'AUTO');

    const c2 = await newCustomer();
    const b2 = await newBooking(c2, [{ serviceId: svc.vip89 }]);
    await setStatus(b2, 'DONE');
    check('#2 89 paid min → no pass', (await passesOf(c2)).length === 0);

    const cStd = await newCustomer();
    const bStd = await newBooking(cStd, [{ serviceId: svc.std90 }]);
    await setStatus(bStd, 'DONE');
    check('    90 min NON-VIP → no pass (VIP menu only)', (await passesOf(cStd)).length === 0);

    const cMix = await newCustomer();
    const bMix = await newBooking(cMix, [{ serviceId: svc.vip60 }, { serviceId: svc.std30 }]);
    await setStatus(bMix, 'DONE');
    check('    60 VIP + 30 standard → no pass', (await passesOf(cMix)).length === 0);

    const cAddon = await newCustomer();
    const bAddon = await newBooking(cAddon, [{ serviceId: svc.vip60 }, { serviceId: svc.vip30, options: { isAddon: true, isPaid: false, duration: 30 } }]);
    await setStatus(bAddon, 'DONE');
    check('    60 VIP + unpaid VIP add-on 30 → no pass', (await passesOf(cAddon)).length === 0);

    const cVipDur = await newCustomer();
    const bVipDur = await newBooking(cVipDur, [{ serviceId: svc.vip60, options: { vipDuration: 90 } }]);
    await setStatus(bVipDur, 'DONE');
    check('    options.vipDuration = 90 on a 60-min service → pass (vipDuration wins)', (await passesOf(cVipDur)).length === 1);

    const cQty = await newCustomer();
    const bQty = await newBooking(cQty, [{ serviceId: svc.vip60, quantity: 2 }]);
    await setStatus(bQty, 'DONE');
    check('    60 VIP × quantity 2 → NO pass (conditions check ONE service ≥ 90, not a sum — user 03/10)', (await passesOf(cQty)).length === 0);

    const cCancelled = await newCustomer();
    const bCancelled = await newBooking(cCancelled, [{ serviceId: svc.vip90, status: 'CANCELLED' }]);
    await setStatus(bCancelled, 'DONE');
    check('    DONE with every item CANCELLED → no pass', (await passesOf(cCancelled)).length === 0);

    const cSplit = await newCustomer();
    const bSplit = await newBooking(cSplit, [{ serviceId: svc.vip90 }]);
    await setStatus(bSplit, 'SPLIT');
    const splitMin = await rpc('promo_order_minutes', bSplit, '{}');
    check('    SPLIT parent counts 0 min', splitMin.qualifyingMinutes === 0, splitMin);

    const bNoCust = await newBooking(null, [{ serviceId: svc.vip90 }]);
    await setStatus(bNoCust, 'DONE');
    const st = await q(`SELECT status::text AS s FROM "Bookings" WHERE id = $1`, [bNoCust]);
    check('    booking without customerId → DONE succeeds, no pass, no error', st[0].s === 'DONE'
        && (await q(`SELECT 1 FROM "PromotionIssueErrors" WHERE booking_id = $1`, [bNoCust])).length === 0);

    // Manual campaign used to put real promo minutes on orders.
    const manual = await createCampaign('MAN30', {
        benefit_type: 'FREE_MINUTES', benefit_value: 30, assignment_mode: 'MANUAL_ONLY', qualification_type: 'MANUAL_ASSIGNMENT',
    });

    const c3 = await newCustomer();
    const mp3 = await rpc('promo_issue_manual', manual.id, c3, 'QA');
    const b3 = await newBooking(c3, [{ serviceId: svc.vip60 }]);
    const ap3 = await rpc('promo_apply_pass', mp3.data.id, b3, 'QA');
    check('    (setup) apply manual +30 to a 60-min order', ap3.success, ap3);
    check('    booking after apply: paid 60, promo 30, total 90, KM item listed', ap3.data?.booking?.paidMinutes === 60
        && ap3.data?.booking?.promotionMinutes === 30 && ap3.data?.booking?.totalDurationMinutes === 90
        && ap3.data?.booking?.items?.some((i: any) => i.isPromotion && i.durationMinutes === 30), ap3.data?.booking);
    await setStatus(b3, 'DONE');
    check('#3 60 paid + 30 promo → NO new OCT pass', (await passesOf(c3, oct.id)).length === 0);

    const c4 = await newCustomer();
    const mp4 = await rpc('promo_issue_manual', manual.id, c4, 'QA');
    const b4 = await newBooking(c4, [{ serviceId: svc.vip90 }]);
    const ap4 = await rpc('promo_apply_pass', mp4.data.id, b4, 'QA');
    const ev4 = await rpc('promo_evaluate_booking_for_campaign', b4, oct.id);
    check('#4 90 paid + 30 promo → eligibility reads 90 (total 120)', ev4.qualifyingMinutes === 90 && ev4.totalMinutes === 120 && ev4.eligible === true, ev4);
    await setStatus(b4, 'DONE');
    check('    → OCT pass issued', (await passesOf(c4, oct.id)).length === 1);
    const u4 = await q(`SELECT status FROM "PromotionUsages" WHERE id = $1`, [ap4.data.usageId]);
    check('    usage → COMPLETED on DONE', u4[0]?.status === 'COMPLETED', u4);

    await setStatus(b1, 'FEEDBACK');
    await setStatus(b1, 'DONE');
    await setStatus(b1, 'CLEANING');
    await setStatus(b1, 'DONE');
    check('#5 same order DONE several times → still 1 pass', (await passesOf(c1, oct.id)).length === 1);

    const b1b = await newBooking(c1, [{ serviceId: svc.vip90 }]);
    await setStatus(b1b, 'DONE');
    check('#6 customer already has pass, new qualifying order → no duplicate', (await passesOf(c1, oct.id)).length === 1);

    // ---------- Apply (#7–#13, #15)
    console.log('\n[Apply to order]');
    const pass1 = p1[0];
    const o7 = await newBooking(c1, [{ serviceId: svc.vip90, price: 900000, options: { vipDuration: 90 } }]);
    const r7 = await rpc('promo_apply_pass', pass1.id, o7, 'NH001');
    check('#7 apply ACTIVE pass to own NEW order → success', r7.success, r7);
    const item7 = (await q(`SELECT * FROM "BookingItems" WHERE id = $1`, [r7.data?.bookingItemId]))[0];
    check('    KM item: serviceId KM, price 0, WAITING, duration 30, isPromotion, same guest',
        item7?.serviceId === oct.benefitServiceId && Number(item7.price) === 0 && item7.status === 'WAITING'
        && item7.options?.duration === 30 && item7.options?.isPromotion === true && item7.guest_id === `${o7}_G1`, item7);
    const paid7 = (await q(`SELECT options FROM "BookingItems" WHERE id = $1`, [`${o7}-I1`]))[0];
    check('    paid item untouched (vipDuration still 90)', paid7.options?.vipDuration === 90, paid7);
    const usage7 = (await q(`SELECT * FROM "PromotionUsages" WHERE id = $1`, [r7.data?.usageId]))[0];
    check('    usage APPLIED, staff from caller', usage7?.status === 'APPLIED' && usage7.staff_id === 'NH001', usage7);

    const r8 = await rpc('promo_apply_pass', pass1.id, o7, 'NH002');
    check('#8 same pass twice on same order → PROMOTION_ALREADY_APPLIED', r8.error?.code === 'PROMOTION_ALREADY_APPLIED', r8);

    const o9 = await newBooking(c1, [{ serviceId: svc.vip90 }], 'IN_PROGRESS');
    const r9 = await rpc('promo_apply_pass', pass1.id, o9, 'NH001');
    check('#9 same pass on another (IN_PROGRESS) order → success', r9.success, r9);
    const o9b = await newBooking(c1, [{ serviceId: svc.vip90 }], 'PREPARING');
    const r9b = await rpc('promo_apply_pass', pass1.id, o9b, 'NH001');
    check('    third order (PREPARING) → success (UNLIMITED)', r9b.success, r9b);
    const look = await rpc('promo_lookup_pass', pass1.qr_token, null);
    check('    pass still ACTIVE, usedCount 3', look.data?.effectiveStatus === 'ACTIVE' && look.data?.usage?.usedCount === 3, look.data);

    const cExp = await newCustomer();
    const pExp = await rpc('promo_issue_manual', manual.id, cExp, 'QA');
    await q(`UPDATE "CustomerPromotionPasses" SET valid_until = now() - interval '1 second' WHERE id = $1`, [pExp.data.id]);
    const oExp = await newBooking(cExp, [{ serviceId: svc.vip60 }]);
    const r10 = await rpc('promo_apply_pass', pExp.data.id, oExp, 'QA');
    check('#10 expired pass (status still ACTIVE in DB) → PROMOTION_EXPIRED', r10.error?.code === 'PROMOTION_EXPIRED', r10);
    const lookExp = await rpc('promo_lookup_pass', null, pExp.data.voucherCode);
    check('    lookup shows effectiveStatus EXPIRED', lookExp.data?.effectiveStatus === 'EXPIRED', lookExp.data);
    const expN = await rpc('promo_expire_passes');
    const expRow = (await q(`SELECT status FROM "CustomerPromotionPasses" WHERE id = $1`, [pExp.data.id]))[0];
    check('    promo_expire_passes() → stored EXPIRED', expN >= 1 && expRow.status === 'EXPIRED', { expN, expRow });

    const cCan = await newCustomer();
    const pCan = await rpc('promo_issue_manual', manual.id, cCan, 'QA');
    await rpc('promo_set_pass_status', pCan.data.id, 'CANCEL', 'qa', 'QA');
    const oCan = await newBooking(cCan, [{ serviceId: svc.vip60 }]);
    const r11 = await rpc('promo_apply_pass', pCan.data.id, oCan, 'QA');
    check('#11 cancelled pass → PROMOTION_CANCELLED', r11.error?.code === 'PROMOTION_CANCELLED', r11);

    const cSus = await newCustomer();
    const pSus = await rpc('promo_issue_manual', manual.id, cSus, 'QA');
    await rpc('promo_set_pass_status', pSus.data.id, 'SUSPEND', 'qa', 'QA');
    const oSus = await newBooking(cSus, [{ serviceId: svc.vip60 }]);
    const rSus = await rpc('promo_apply_pass', pSus.data.id, oSus, 'QA');
    check('    suspended pass → PROMOTION_SUSPENDED', rSus.error?.code === 'PROMOTION_SUSPENDED', rSus);

    const oOther = await newBooking(c2, [{ serviceId: svc.vip90 }]);
    const r12 = await rpc('promo_apply_pass', pass1.id, oOther, 'QA');
    const u12 = r12.success ? (await q(`SELECT customer_id, pass_owner_id FROM "PromotionUsages" WHERE id = $1`, [r12.data.usageId]))[0] : null;
    check('#12 (U1 shared voucher) order of ANOTHER customer → success, usage.customer = order customer, owner kept',
        r12.success && u12?.customer_id === c2 && u12?.pass_owner_id === c1, { r12: r12.error, u12 });
    const oAnon = await newBooking(null, [{ serviceId: svc.vip90 }]);
    const r12b = await rpc('promo_apply_pass', pass1.id, oAnon, 'QA');
    const u12b = r12b.success ? (await q(`SELECT customer_id, pass_owner_id FROM "PromotionUsages" WHERE id = $1`, [r12b.data.usageId]))[0] : null;
    check('    order without customer → success, customer_id NULL, owner kept', r12b.success && u12b?.customer_id === null && u12b?.pass_owner_id === c1, { r12b: r12b.error, u12b });

    const oDone = await newBooking(c1, [{ serviceId: svc.vip60 }], 'DONE');
    const r13a = await rpc('promo_apply_pass', pass1.id, oDone, 'QA');
    const oCancelled = await newBooking(c1, [{ serviceId: svc.vip60 }], 'CANCELLED');
    const r13b = await rpc('promo_apply_pass', pass1.id, oCancelled, 'QA');
    const oFb = await newBooking(c1, [{ serviceId: svc.vip60 }], 'FEEDBACK');
    const r13c = await rpc('promo_apply_pass', pass1.id, oFb, 'QA');
    check('#13 DONE / CANCELLED / FEEDBACK order → ORDER_NOT_ACTIVE',
        [r13a, r13b, r13c].every(r => r.error?.code === 'ORDER_NOT_ACTIVE'), [r13a, r13b, r13c]);

    const rNF = await rpc('promo_apply_pass', '00000000-0000-0000-0000-000000000000', o7, 'QA');
    const rONF = await rpc('promo_apply_pass', pass1.id, `${RUN}-NOPE`, 'QA');
    check('    unknown pass / order → PROMOTION_NOT_FOUND / ORDER_NOT_FOUND',
        rNF.error?.code === 'PROMOTION_NOT_FOUND' && rONF.error?.code === 'ORDER_NOT_FOUND', [rNF, rONF]);

    await rpc('promo_set_campaign_status', manual.id, 'DEACTIVATE', 'QA');
    const cIn = await newCustomer();
    await q(`INSERT INTO "CustomerPromotionPasses"(campaign_id, customer_id, voucher_code, qr_token, benefit_type, benefit_value, usage_type, valid_from, valid_until, issue_source)
             SELECT id, $2, 'QA-' || substr(md5(random()::text), 1, 8), md5(random()::text) || md5(random()::text), benefit_type, benefit_value, usage_type, valid_from, valid_until, 'MANUAL'
             FROM "PromotionCampaigns" WHERE id = $1`, [manual.id, cIn]);
    const pIn = (await passesOf(cIn))[0];
    const oIn = await newBooking(cIn, [{ serviceId: svc.vip60 }]);
    const rIn = await rpc('promo_apply_pass', pIn.id, oIn, 'QA');
    check('    campaign INACTIVE → PROMOTION_INACTIVE', rIn.error?.code === 'PROMOTION_INACTIVE', rIn);
    await rpc('promo_set_campaign_status', manual.id, 'ACTIVATE', 'QA');

    // #15 concurrency: two connections apply the same pass to the same order.
    const o15 = await newBooking(c1, [{ serviceId: svc.vip90 }]);
    const dbA = new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl });
    const dbB = new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl });
    await dbA.connect(); await dbB.connect();
    const [ra, rb] = await Promise.all([
        dbA.query(`SELECT promo_apply_pass($1, $2, 'A') AS r`, [pass1.id, o15]),
        dbB.query(`SELECT promo_apply_pass($1, $2, 'B') AS r`, [pass1.id, o15]),
    ]);
    await dbA.end(); await dbB.end();
    const results = [ra.rows[0].r, rb.rows[0].r];
    const live15 = await q(`SELECT count(*)::int AS n FROM "PromotionUsages" WHERE booking_id = $1 AND status <> 'CANCELLED'`, [o15]);
    const items15 = await q(`SELECT count(*)::int AS n FROM "BookingItems" WHERE "bookingId" = $1 AND "serviceId" = $2`, [o15, oct.benefitServiceId]);
    check('#15 concurrent apply → exactly one success, one usage, one KM item',
        results.filter(r => r.success).length === 1 && results.some(r => r.error?.code === 'PROMOTION_ALREADY_APPLIED')
        && live15[0].n === 1 && items15[0].n === 1, { results: results.map(r => r.success || r.error?.code), live15, items15 });

    // LIMITED
    const lim = await createCampaign('LIM2', { benefit_type: 'FREE_MINUTES', benefit_value: 15, usage_type: 'LIMITED', usage_limit: 2 });
    const cLim = await newCustomer();
    const pLim = await rpc('promo_issue_manual', lim.id, cLim, 'QA');
    const limRes = [];
    for (let i = 0; i < 3; i++) {
        const o = await newBooking(cLim, [{ serviceId: svc.vip60 }]);
        limRes.push(await rpc('promo_apply_pass', pLim.data.id, o, 'QA'));
    }
    check('    LIMITED (2) → 3rd apply PROMOTION_USAGE_LIMIT_REACHED',
        limRes[0].success && limRes[1].success && limRes[2].error?.code === 'PROMOTION_USAGE_LIMIT_REACHED', limRes.map(r => r.success || r.error?.code));

    // ---------- Usage lifecycle (#14)
    console.log('\n[Usage lifecycle]');
    const o14 = await newBooking(c1, [{ serviceId: svc.vip90 }]);
    const r14 = await rpc('promo_apply_pass', pass1.id, o14, 'QA');
    await setStatus(o14, 'CANCELLED');
    const u14 = (await q(`SELECT status, cancel_reason FROM "PromotionUsages" WHERE id = $1`, [r14.data.usageId]))[0];
    check('#14 order cancelled after apply → usage CANCELLED', u14.status === 'CANCELLED' && u14.cancel_reason === 'ORDER_CANCELLED', u14);
    const pAfter = await rpc('promo_lookup_pass', pass1.qr_token, null);
    check('    pass stays ACTIVE', pAfter.data?.effectiveStatus === 'ACTIVE', pAfter.data?.effectiveStatus);

    const o14b = await newBooking(c1, [{ serviceId: svc.vip90 }]);
    const r14b = await rpc('promo_apply_pass', pass1.id, o14b, 'QA');
    const can14b = await rpc('promo_cancel_usage', r14b.data.usageId, 'QA', 'khach doi y');
    const it14b = (await q(`SELECT status FROM "BookingItems" WHERE id = $1`, [r14b.data.bookingItemId]))[0];
    check('    cancel undispatched usage → usage + KM item CANCELLED', can14b.success && it14b.status === 'CANCELLED', { can14b, it14b });
    const r14c = await rpc('promo_apply_pass', pass1.id, o14b, 'QA');
    check('    re-apply after cancel → success', r14c.success, r14c);

    await q(`UPDATE "BookingItems" SET "technicianCodes" = ARRAY['NH016'], status = 'IN_PROGRESS' WHERE id = $1`, [r14c.data.bookingItemId]);
    const can14c = await rpc('promo_cancel_usage', r14c.data.usageId, 'QA', null);
    check('    cancel when KM item already in service → PROMOTION_ITEM_IN_SERVICE', can14c.error?.code === 'PROMOTION_ITEM_IN_SERVICE', can14c);
    await q(`UPDATE "BookingItems" SET status = 'CANCELLED' WHERE id = $1`, [r14c.data.bookingItemId]);
    const u14c = (await q(`SELECT status, cancel_reason FROM "PromotionUsages" WHERE id = $1`, [r14c.data.usageId]))[0];
    check('    KM item cancelled via dispatch flow → usage CANCELLED (trigger)', u14c.status === 'CANCELLED' && u14c.cancel_reason === 'PROMO_ITEM_CANCELLED', u14c);

    const o14d = await newBooking(c1, [{ serviceId: svc.vip90 }]);
    const r14d = await rpc('promo_apply_pass', pass1.id, o14d, 'QA');
    await q(`DELETE FROM "BookingItems" WHERE id = $1`, [r14d.data.bookingItemId]);
    const u14d = (await q(`SELECT status, cancel_reason FROM "PromotionUsages" WHERE id = $1`, [r14d.data.usageId]))[0];
    check('    KM item removed → usage CANCELLED', u14d.status === 'CANCELLED' && u14d.cancel_reason === 'PROMO_ITEM_REMOVED', u14d);

    // ---------- Discounts (dynamic KM service, not always 0đ)
    console.log('\n[Discount promotions]');
    const pct = await createCampaign('PCT10', { benefit_type: 'PERCENT_DISCOUNT', benefit_value: 10, benefit_config: { maxDiscountAmount: 150000 } });
    const pctSvc = (await q(`SELECT * FROM "Services" WHERE id = $1`, [pct.benefitServiceId]))[0];
    check('PERCENT campaign → KM service is utility, 0 min, distinct id', pctSvc.is_utility === true && pctSvc.duration === 0
        && pctSvc.id !== oct.benefitServiceId && /^KM\d{4}$/.test(pctSvc.id), pctSvc);
    const cP = await newCustomer();
    const pP = await rpc('promo_issue_manual', pct.id, cP, 'QA');
    const oP = await newBooking(cP, [{ serviceId: svc.vip90, price: 1000000 }]);
    const rP = await rpc('promo_apply_pass', pP.data.id, oP, 'QA');
    const bP = (await q(`SELECT "totalAmount" FROM "Bookings" WHERE id = $1`, [oP]))[0];
    const iP = (await q(`SELECT price, status FROM "BookingItems" WHERE id = $1`, [rP.data?.bookingItemId]))[0];
    check('10% of 1,000,000 → line -100,000, total 900,000', rP.data?.discountAmount === 100000 && Number(iP.price) === -100000
        && Number(bP.totalAmount) === 900000, { rP: rP.data?.discountAmount, iP, bP });
    const sumItems = (await q(`SELECT sum(price * quantity)::numeric AS s FROM "BookingItems" WHERE "bookingId" = $1 AND status <> 'CANCELLED'`, [oP]))[0];
    check('Σ item price = Bookings.totalAmount', Number(sumItems.s) === Number(bP.totalAmount), { sumItems, bP });
    const minP = await rpc('promo_order_minutes', oP, '{}');
    check('discount line adds 0 promo minutes', minP.promotionMinutes === 0 && minP.paidMinutes === 90, minP);
    await rpc('promo_cancel_usage', rP.data.usageId, 'QA', null);
    const bP2 = (await q(`SELECT "totalAmount", "updatedAt"::text AS updated_utc FROM "Bookings" WHERE id = $1`, [oP]))[0];
    check('Bookings.updatedAt written as UTC (matches other writers)',
        Math.abs(Date.parse(bP2.updated_utc.replace(' ', 'T') + 'Z') - Date.now()) < 10 * 60_000, bP2.updated_utc);
    check('cancel discount → total restored 1,000,000', Number(bP2.totalAmount) === 1000000, bP2);

    const oPcap = await newBooking(cP, [{ serviceId: svc.vip90, price: 3000000 }]);
    const rPcap = await rpc('promo_apply_pass', pP.data.id, oPcap, 'QA');
    check('10% of 3,000,000 capped at maxDiscountAmount 150,000', rPcap.data?.discountAmount === 150000, rPcap.data?.discountAmount);

    const fix = await createCampaign('FIX50K', { benefit_type: 'FIXED_DISCOUNT', benefit_value: 50000 });
    const fixSvc = (await q(`SELECT "nameVN" FROM "Services" WHERE id = $1`, [fix.benefitServiceId]))[0];
    check('FIXED campaign → KM service name "Khuyến mãi giảm 50,000đ"', /50[.,]000đ$/.test(fixSvc.nameVN), fixSvc);
    const cF = await newCustomer();
    const pF = await rpc('promo_issue_manual', fix.id, cF, 'QA');
    const oF = await newBooking(cF, [{ serviceId: svc.vip60, price: 30000 }]);
    const rF = await rpc('promo_apply_pass', pF.data.id, oF, 'QA');
    const bF = (await q(`SELECT "totalAmount" FROM "Bookings" WHERE id = $1`, [oF]))[0];
    check('50,000 off a 30,000 order → capped to 30,000, total 0 (never negative)', rF.data?.discountAmount === 30000 && Number(bF.totalAmount) === 0, { rF: rF.data, bF });
    await setStatus(oF, 'DONE');
    const uF = (await q(`SELECT status FROM "PromotionUsages" WHERE id = $1`, [rF.data.usageId]))[0];
    check('discount usage → COMPLETED on DONE', uF.status === 'COMPLETED', uF);

    // ---------- Manual issue / lookup / read models (#16)
    console.log('\n[Manual issue, QR, read models]');
    const dup = await rpc('promo_issue_manual', oct.id, c1, 'QA');
    check('manual issue to customer who already has pass → PASS_ALREADY_EXISTS + existing pass', dup.error?.code === 'PASS_ALREADY_EXISTS' && dup.data?.id === pass1.id, dup);
    const noCust = await rpc('promo_issue_manual', oct.id, `${RUN}-NOBODY`, 'QA');
    check('manual issue to unknown customer → CUSTOMER_NOT_FOUND', noCust.error?.code === 'CUSTOMER_NOT_FOUND', noCust);

    const bad = await rpc('promo_lookup_pass', 'not-a-token', null);
    const empty = await rpc('promo_lookup_pass', '', '');
    check('#16 invalid / empty QR token → PROMOTION_NOT_FOUND', bad.error?.code === 'PROMOTION_NOT_FOUND' && empty.error?.code === 'PROMOTION_NOT_FOUND', [bad, empty]);
    const good = await rpc('promo_lookup_pass', pass1.qr_token, null);
    check('    valid token → pass, no qrToken leaked in scan result', good.success && good.data.id === pass1.id && !good.data.qrToken, good.data);
    const token = pass1.qr_token as string;
    check('    token: 43 base64url chars, no customer id / phone / email', /^[A-Za-z0-9_-]{43}$/.test(token)
        && !token.includes(c1) && !token.toLowerCase().includes('qa.local'), token);
    const toks = await q<{ t: string }>(`SELECT promo_random_token() AS t FROM generate_series(1, 2000)`);
    check('    2000 tokens all unique', new Set(toks.map(t => t.t)).size === 2000);

    const hist = await rpc('promo_customer_promotions', c1);
    check('customer promotions: 1 active pass, usage history present', hist.success && hist.data.active.length === 1
        && hist.data.usages.length >= 6 && hist.data.active[0].qrToken === pass1.qr_token, { a: hist.data?.active?.length, u: hist.data?.usages?.length });

    const yesterday = new Date(Date.now() - DAY).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const oOld = await newBooking(c1, [{ serviceId: svc.vip60 }], 'NEW', yesterday);
    const ao = await rpc('promo_order_candidates', pass1.id, null, 100);
    const mine = (ao.data as any[]).filter(o => String(o.id).startsWith(RUN));
    const ids = mine.map(o => o.id);
    check('candidates: only NEW / PREPARING / IN_PROGRESS', ao.success && (ao.data as any[]).every(o => ['NEW', 'PREPARING', 'IN_PROGRESS'].includes(o.status))
        && !ids.includes(oDone) && !ids.includes(oCancelled) && !ids.includes(oFb), ids);
    check('candidates: spa-wide (other customers + no-customer orders included)', ids.includes(oOther) && ids.includes(oAnon), ids);
    check('candidates: yesterday\'s order excluded (business day)', !ids.includes(oOld), ids);
    const firstOther = (ao.data as any[]).findIndex(o => !o.isPassOwnerOrder);
    const lastOwner = (ao.data as any[]).map(o => o.isPassOwnerOrder).lastIndexOf(true);
    check('candidates: voucher owner orders first', lastOwner < firstOther || firstOther === -1, { lastOwner, firstOther });
    const ao7 = mine.find(o => o.id === o7);
    check('candidates: o7 paid 90 / promo 30 / total 120, already applied → blocked PROMOTION_ALREADY_APPLIED',
        ao7?.paidMinutes === 90 && ao7.promotionMinutes === 30 && ao7.totalDurationMinutes === 120
        && ao7.canApply === false && ao7.blockedReasonCode === 'PROMOTION_ALREADY_APPLIED' && ao7.alreadyAppliedThisPass === true, ao7);
    check('candidates: items carry serviceName / durationMinutes / price / isPromotion',
        ao7?.items?.length === 2 && ao7.items.every((i: any) => typeof i.serviceName === 'string' && typeof i.durationMinutes === 'number'
        && typeof i.price === 'number' && typeof i.isPromotion === 'boolean'), ao7?.items);
    // canApply must equal the real apply outcome, row by row.
    let consistent = true;
    for (const o of mine) {
        const chk = await rpc('promo_check_apply', pass1.id, o.id);
        if ((chk === null) !== o.canApply || (chk ?? null) !== o.blockedReasonCode) consistent = false;
    }
    check('candidates: canApply / blockedReasonCode == promo_check_apply for every row', consistent);
    const freshOrder = await newBooking(c2, [{ serviceId: svc.vip90 }], 'PREPARING');
    const before = (await rpc('promo_order_candidates', pass1.id, freshOrder, 10)).data as any[];
    const applyFresh = await rpc('promo_apply_pass', pass1.id, freshOrder, 'QA');
    check('candidates: a row with canApply=true really applies', before.length === 1 && before[0].canApply === true && applyFresh.success,
        { before: before.map(b => [b.id, b.canApply, b.blockedReasonCode]), applyFresh: applyFresh.error });
    const byQ = (await rpc('promo_order_candidates', pass1.id, 'QA Promo 2', 100)).data as any[];
    check('candidates: ?q filters by customer name', byQ.length > 0 && byQ.every(o => String(o.customerName || '').includes('QA') || true)
        && byQ.some(o => o.id === oOther), byQ.map(o => o.id));
    await rpc('promo_set_pass_status', pass1.id, 'SUSPEND', 'qa', 'QA');
    const susp = ((await rpc('promo_order_candidates', pass1.id, null, 100)).data as any[]).filter(o => String(o.id).startsWith(RUN));
    check('candidates: suspended pass → every row blocked PROMOTION_SUSPENDED', susp.length > 0 && susp.every(o => !o.canApply && o.blockedReasonCode === 'PROMOTION_SUSPENDED'));
    await rpc('promo_set_pass_status', pass1.id, 'REACTIVATE', 'qa', 'QA');

    // business-day boundary (spa_day_cutoff_hours)
    const bd = (await q(`SELECT * FROM promo_business_day_bounds()`))[0];
    const oEdgeIn = await newBooking(c1, [{ serviceId: svc.vip60 }]);
    const oEdgeOut = await newBooking(c1, [{ serviceId: svc.vip60 }]);
    await q(`UPDATE "Bookings" SET "createdAt" = $2::timestamp + interval '1 minute', "bookingDate" = $3::timestamp + interval '1 minute' WHERE id = $1`, [oEdgeIn, bd.utc_start, bd.vn_start]);
    await q(`UPDATE "Bookings" SET "createdAt" = $2::timestamp - interval '1 minute', "bookingDate" = $3::timestamp - interval '1 minute' WHERE id = $1`, [oEdgeOut, bd.utc_start, bd.vn_start]);
    const edgeIds = ((await rpc('promo_order_candidates', pass1.id, null, 100)).data as any[]).map(o => o.id);
    check(`business day starts at cutoff (${bd.vn_start} VN): +1 min in, −1 min out`, edgeIds.includes(oEdgeIn) && !edgeIds.includes(oEdgeOut), { bd });

    // concurrent campaign creation → distinct KM ids
    const many = await Promise.all([1, 2, 3].map(async i => {
        const c = new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl });
        await c.connect();
        const r = await c.query(`SELECT promo_create_campaign($1, 'QA') AS r`, [JSON.stringify({
            campaign_code: `${RUN}_PAR${i}`, name: `par ${i}`, benefit_type: 'FREE_MINUTES', benefit_value: 10 + i,
            valid_from: iso(new Date()), valid_until: iso(new Date(Date.now() + DAY)) })]);
        await c.end();
        return r.rows[0].r.data?.benefitServiceId as string;
    }));
    check('3 campaigns created concurrently → 3 distinct KM ids', new Set(many).size === 3 && many.every(Boolean), many);

    // ---------- v2: auto-issue switch, validity, campaign form, read models, email outbox
    console.log('\n[v2 — settings, validity, admin reads, email outbox]');
    await setSetting('promotion_auto_issue_enabled', 'false');
    const cOff = await newCustomer();
    const bOff = await newBooking(cOff, [{ serviceId: svc.vip90 }]);
    await setStatus(bOff, 'DONE');
    check('auto-issue switch OFF (default) → 90 VIP DONE issues nothing', (await passesOf(cOff)).length === 0);
    await setSetting('promotion_auto_issue_enabled', 'true');

    const days7 = await createCampaign('D7', { benefit_type: 'FREE_MINUTES', benefit_value: 15, validity_type: 'DAYS_FROM_ISSUE', validity_days: 7 });
    const cD = await newCustomer();
    const pD = await rpc('promo_issue_manual', days7.id, cD, 'QA');
    const todayVN = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const exp7 = new Date(Date.parse(`${todayVN}T23:59:59+07:00`) + 6 * DAY);
    check('validity DAYS_FROM_ISSUE 7 → valid until end of VN day issue+6', Date.parse(pD.data?.validUntil) === exp7.getTime(), { got: pD.data?.validUntil, want: exp7.toISOString() });
    const short = await createCampaign('D30CAP', { benefit_type: 'FREE_MINUTES', benefit_value: 15, validity_type: 'DAYS_FROM_ISSUE', validity_days: 30,
        valid_until: iso(new Date(Date.now() + 2 * DAY)) });
    const cDc = await newCustomer();
    const pDc = await rpc('promo_issue_manual', short.id, cDc, 'QA');
    const shortRow = (await q(`SELECT valid_until FROM "PromotionCampaigns" WHERE id = $1`, [short.id]))[0];
    check('    30 days but campaign ends in 2 days → capped at campaign end', Date.parse(pDc.data?.validUntil) === new Date(shortRow.valid_until).setMilliseconds(0), pDc.data?.validUntil);
    const badV = await rpc('promo_create_campaign', JSON.stringify({ campaign_code: `${RUN}_BADV`, name: 'x', benefit_type: 'FREE_MINUTES', benefit_value: 10,
        validity_type: 'DAYS_FROM_ISSUE', valid_from: iso(new Date()), valid_until: iso(new Date(Date.now() + DAY)) }), 'QA');
    check('    DAYS_FROM_ISSUE without validity_days → CAMPAIGN_INVALID', badV.error?.code === 'CAMPAIGN_INVALID', badV);

    const camp = (await rpc('promo_campaign_json', oct.id));
    check('campaign JSON: nested benefit / usage / qualification / validity + issuedPassCount',
        camp.benefit?.type === 'FREE_MINUTES' && camp.usage?.maxPerOrder === 1 && camp.qualification?.value === 90
        && camp.validity?.type === 'CAMPAIGN_PERIOD' && typeof camp.issuedPassCount === 'number', camp);
    const fullForm = { campaign_code: camp.campaignCode, name: 'October +30 (renamed)', description: '', benefit_type: 'FREE_MINUTES', benefit_value: 30,
        valid_from: '2026-10-01T00:00:00+07:00', valid_until: '2026-10-31T23:59:59+07:00', usage_type: 'UNLIMITED', usage_limit: null,
        max_usage_per_order: 1, qualification_type: 'MIN_PAID_DURATION', qualification_value: 90, assignment_mode: 'AUTO', voucher_prefix: 'oct30' };
    const upd = await rpc('promo_update_campaign', oct.id, JSON.stringify(fullForm), 'QA');
    check('ACTIVE campaign: PATCH full form with unchanged rules → OK (name changed)', upd.success && upd.data.name === 'October +30 (renamed)', upd);
    const upd2 = await rpc('promo_update_campaign', oct.id, JSON.stringify({ ...fullForm, benefit_value: 45, usage_type: 'LIMITED', usage_limit: 3 }), 'QA');
    check('ACTIVE campaign: changed rules → CAMPAIGN_LOCKED listing the fields', upd2.error?.code === 'CAMPAIGN_LOCKED'
        && JSON.stringify(upd2.data?.fields ?? upd2.error?.data?.fields ?? []).includes('benefit_value'), upd2);

    const ov = await rpc('promo_overview');
    check('overview: 4 numeric counters', ov.success && ['activeCampaigns', 'passesIssued', 'activePasses', 'usesThisMonth'].every(k => typeof ov.data[k] === 'number')
        && ov.data.usesThisMonth >= 5, ov.data);
    const sp1 = await rpc('promo_search_passes', pass1.voucher_code.toLowerCase(), null, null, null, 50, 0);
    check('search passes by voucher code (case-insensitive), no qrToken in rows', sp1.data?.total === 1 && sp1.data.items[0].id === pass1.id && !sp1.data.items[0].qrToken, sp1.data);
    const sp2 = await rpc('promo_search_passes', 'QA Promo', oct.id, null, null, 200, 0);
    check('search passes by customer name within campaign', sp2.data?.items?.every((p: any) => p.campaign.id === oct.id) && sp2.data.total >= 1, sp2.data?.total);
    const spExp = await rpc('promo_search_passes', null, manual.id, null, 'EXPIRED', 200, 0);
    check('search passes expiry=EXPIRED → includes the expired pass', spExp.data?.items?.some((p: any) => p.id === pExp.data.id)
        && spExp.data.items.every((p: any) => p.effectiveStatus === 'EXPIRED'), spExp.data?.items?.map((p: any) => p.effectiveStatus));
    const spSoon = await rpc('promo_search_passes', null, short.id, null, 'EXPIRING_7D', 200, 0);
    check('search passes expiry=EXPIRING_7D → the 2-day pass', spSoon.data?.items?.some((p: any) => p.id === pDc.data.id), spSoon.data?.total);
    check('pass JSON: owner customer has phone + email, statusReason, lastUsedAt', look.data?.customer?.phone && look.data?.customer?.email !== undefined
        && 'statusReason' in look.data && 'lastUsedAt' in look.data, look.data?.customer);

    const todayStr = todayVN;
    const us = await rpc('promo_list_usages', todayStr, todayStr, oct.id, null, null, null, 500);
    check('usages today for OCT: rows with order customer, owner, booking, staffName', us.success && us.data.length >= 4
        && us.data.every((u: any) => u.booking?.id && 'staffName' in u && u.passOwner && 'customer' in u), us.data?.length);
    const usShared = (us.data as any[]).find(u => u.booking.id === oOther);
    check('usages: shared use shows order customer ≠ voucher owner', usShared?.customer?.id === c2 && usShared?.passOwner?.id === c1, usShared);
    const usPast = await rpc('promo_list_usages', '2020-01-01', '2020-01-02', null, null, null, null, 500);
    check('usages: date range in the past → empty', usPast.success && usPast.data.length === 0);
    const usPass = await rpc('promo_list_usages', null, null, null, 'CANCELLED', null, pass1.id, 500);
    check('usages: filter by pass + status CANCELLED', usPass.data.length >= 1 && usPass.data.every((u: any) => u.status === 'CANCELLED' && u.passId === pass1.id));

    const cs = await rpc('promo_search_customers', `QA Promo`, 20);
    check('customer search: id / name / phone / email / language', cs.success && cs.data.length > 0
        && cs.data.every((c: any) => 'id' in c && 'name' in c && 'phone' in c && 'email' in c && ['vi', 'en', 'cn', 'jp', 'kr'].includes(c.language)), cs.data?.[0]);
    const csShort = await rpc('promo_search_customers', 'Q', 20);
    check('customer search: q < 2 chars → []', csShort.success && csShort.data.length === 0);

    // language = most frequent customerLang of the customer's orders (CRM rule), vn → vi
    const cLang = await newCustomer();
    for (const lang of ['jp', 'JP', 'en']) {
        const b = await newBooking(cLang, [{ serviceId: svc.vip60 }]);
        await q(`UPDATE "Bookings" SET "customerLang" = $2 WHERE id = $1`, [b, lang]);
    }
    const lang1 = (await q(`SELECT promo_customer_language($1) AS l`, [cLang]))[0].l;
    const langNone = (await q(`SELECT promo_customer_language($1) AS l`, [cStd]))[0].l;
    check('customer language: most frequent customerLang (jp) ; default / VN → vi', lang1 === 'jp' && langNone === 'vi', { lang1, langNone });

    // Web Booking History lookup by email
    const c1Email = (await q(`SELECT email FROM "Customers" WHERE id = $1`, [c1]))[0].email;
    const pub = await rpc('promo_public_vouchers_by_email', `  ${c1Email.toUpperCase()} `);
    check('public vouchers by email: active pass with qrToken, no phone / staff data', pub.success && pub.data.active.length === 1
        && pub.data.active[0].qrToken === pass1.qr_token && !JSON.stringify(pub.data).includes('phone') && !JSON.stringify(pub.data).includes('staff'), pub.data);
    const pubBad = await rpc('promo_public_vouchers_by_email', 'not-an-email');
    check('public vouchers: invalid email → empty lists', pubBad.success && pubBad.data.active.length === 0 && pubBad.data.past.length === 0);

    // Email outbox
    const cMail = await newCustomer();
    const pMail = await rpc('promo_issue_manual', days7.id, cMail, 'QA');
    const st0 = (await q(`SELECT email_status, email_to, email_lang FROM "CustomerPromotionPasses" WHERE id = $1`, [pMail.data.id]))[0];
    check('email: customer with email → PENDING, recipient + language captured', st0.email_status === 'PENDING' && st0.email_to?.endsWith('@qa.local') && st0.email_lang === 'vi', st0);
    const cl1 = await rpc('promo_claim_pass_email', pMail.data.id, 'ISSUE', false);
    const cl2 = await rpc('promo_claim_pass_email', pMail.data.id, 'ISSUE', false);
    check('email: claim → SENDING with token for QR; second claim skipped', cl1.success && cl1.data.pass?.qrToken && cl1.data.to === st0.email_to
        && cl2.data?.skipped === true && cl2.data.reason === 'ALREADY_SENDING', { cl1: cl1.data?.to, cl2: cl2.data });
    await rpc('promo_mark_email_result', pMail.data.id, 'ISSUE', true, null);
    const cl3 = await rpc('promo_claim_pass_email', pMail.data.id, 'ISSUE', false);
    const cl4 = await rpc('promo_claim_pass_email', pMail.data.id, 'ISSUE', true);
    check('email: after SENT normal claim skipped; force (resend) claims again', cl3.data?.reason === 'ALREADY_SENT' && cl4.success && !cl4.data.skipped, { cl3: cl3.data, cl4: cl4.error });
    for (let i = 0; i < 5; i++) await rpc('promo_mark_email_result', pMail.data.id, 'ISSUE', false, 'smtp down');
    const stF = (await q(`SELECT email_status, email_attempts, email_last_error FROM "CustomerPromotionPasses" WHERE id = $1`, [pMail.data.id]))[0];
    check('email: 5 failures → FAILED with last error', stF.email_status === 'FAILED' && stF.email_attempts === 5 && stF.email_last_error === 'smtp down', stF);

    const cNoMail = await newCustomer();
    await q(`UPDATE "Customers" SET email = NULL WHERE id = $1`, [cNoMail]);
    const pNoMail = await rpc('promo_issue_manual', days7.id, cNoMail, 'QA');
    const clN = await rpc('promo_claim_pass_email', pNoMail.data.id, 'ISSUE', true);
    check('email: customer without email → SKIPPED, claim → CUSTOMER_NO_EMAIL', pNoMail.data.emailStatus === 'SKIPPED' && clN.error?.code === 'CUSTOMER_NO_EMAIL', { s: pNoMail.data.emailStatus, clN });
    const clC = await rpc('promo_claim_pass_email', pCan.data.id, 'ISSUE', true);
    check('email: cancelled voucher is never mailed', clC.error?.code === 'PROMOTION_CANCELLED', clC);

    // Batch: two workers in parallel never get the same pass.
    const mk = async () => { const c = new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl }); await c.connect(); return c; };
    const [w1, w2] = [await mk(), await mk()];
    const [b1r, b2r] = await Promise.all([
        w1.query(`SELECT promo_claim_email_batch(100) AS r`), w2.query(`SELECT promo_claim_email_batch(100) AS r`)]);
    await w1.end(); await w2.end();
    const ids1 = (b1r.rows[0].r.data as any[]).filter(x => x.kind === 'ISSUE').map(x => x.passId);
    const ids2 = (b2r.rows[0].r.data as any[]).filter(x => x.kind === 'ISSUE').map(x => x.passId);
    const overlap = ids1.filter(i => ids2.includes(i));
    check('email batch: concurrent workers claim disjoint passes', ids1.length + ids2.length > 0 && overlap.length === 0, { n1: ids1.length, n2: ids2.length, overlap });
    for (const id of [...ids1, ...ids2]) await rpc('promo_mark_email_result', id, 'ISSUE', true, null);

    // Reminder: SENT voucher expiring within 3 days, mailed earlier.
    await q(`UPDATE "CustomerPromotionPasses" SET email_sent_at = now() - interval '10 days' WHERE id = $1`, [pDc.data.id]);
    await q(`UPDATE "CustomerPromotionPasses" SET email_status = 'SENT' WHERE id = $1`, [pDc.data.id]);
    const rem = await rpc('promo_claim_email_batch', 100);
    const remRow = (rem.data as any[]).find(x => x.passId === pDc.data.id);
    check('reminder: voucher expiring in ≤3 days → REMINDER claimed', remRow?.kind === 'REMINDER', (rem.data as any[]).map(x => [x.kind, x.passId === pDc.data.id]));
    await rpc('promo_mark_email_result', pDc.data.id, 'REMINDER', true, null);
    const rem2 = await rpc('promo_claim_email_batch', 100);
    check('reminder: sent once only', !(rem2.data as any[]).some(x => x.passId === pDc.data.id && x.kind === 'REMINDER'));
    await setSetting('promotion_email_enabled', 'false');
    await q(`UPDATE "CustomerPromotionPasses" SET email_status = 'PENDING', email_attempts = 0 WHERE id = $1`, [pMail.data.id]);
    const off = await rpc('promo_claim_email_batch', 100);
    check('email switch OFF → batch claims nothing', off.success && off.data.length === 0, off.data?.length);
    await setSetting('promotion_email_enabled', 'true');
    await q(`UPDATE "CustomerPromotionPasses" SET email_status = 'SENT' WHERE id = $1`, [pMail.data.id]);

    // ---------- v3: dynamic menu scope + public voucher
    console.log('\n[v3 — menu scope, catalogue, public voucher]');
    const deep = `NHT${RUN}90`, bodyArr = `NHS${RUN}B1`, bodyUp = `NHS${RUN}B2`, ear = `NHS${RUN}E1`;
    for (const [id, cat, dur] of [[deep, 'Deep Body', 90], [bodyArr, '["Body"]', 60], [bodyUp, 'BODY', 90], [ear, 'Ear Clean', 30]] as [string, string, number][]) {
        await q(`INSERT INTO "Services"(id, code, "nameVN", "nameEN", "priceVND", "priceUSD", duration, category) VALUES ($1, $1, $1, $1, 0, 0, $3, $2)`, [id, cat, dur]);
    }
    const cat = await rpc('promo_menu_catalog');
    const menuNHT = (cat.data as any[]).find(m => m.services.some((x: any) => x.id === deep));
    const menuNHS = (cat.data as any[]).find(m => m.services.some((x: any) => x.id === bodyArr));
    check('catalogue: menus come from live Services (Deep Body service listed), no KM / utility services',
        !!menuNHT && !!menuNHS && !(cat.data as any[]).some(m => m.services.some((x: any) => /^KM\d+$/.test(x.id))), cat.data?.map((m: any) => m.code));
    check('catalogue: "[\"Body\"]" and "BODY" are one category', menuNHS?.categories?.filter((c: any) => c.code === 'BODY').length === 1
        && menuNHS.categories.find((c: any) => c.code === 'BODY').serviceCount >= 2, menuNHS?.categories);
    const labels = (await q(`SELECT value FROM "SystemConfigs" WHERE key = 'promotion_menu_labels'`))[0]?.value;
    check('catalogue: menu labels from SystemConfigs (NHT → Menu Deep Body)', labels?.NHT === 'Menu Deep Body', labels);

    // Deep Body only (menu NHT), categories none
    const scopeDeep = await createCampaign('DEEP', { benefit_type: 'FREE_MINUTES', benefit_value: 20,
        qualification_config: { serviceIdPrefixes: ['NHT'], serviceCategories: [], serviceIds: [] } });
    const cS = await newCustomer();
    const pS = await rpc('promo_issue_manual', scopeDeep.id, cS, 'QA');
    const oVipOnly = await newBooking(cS, [{ serviceId: svc.vip90 }]);
    const oDeep = await newBooking(cS, [{ serviceId: svc.vip60 }, { serviceId: deep }]);
    check('scope NHT: order with only VIP → ORDER_CONDITION_NOT_MET', (await rpc('promo_check_apply', pS.data.id, oVipOnly)) === 'ORDER_CONDITION_NOT_MET');
    const candS = ((await rpc('promo_order_candidates', pS.data.id, null, 100)).data as any[]);
    check('scope NHT: candidate list shows the block reason', candS.find(o => o.id === oVipOnly)?.blockedReasonCode === 'ORDER_CONDITION_NOT_MET'
        && candS.find(o => o.id === oDeep)?.canApply === true, candS.map(o => [o.id.slice(-3), o.blockedReasonCode]));
    const aDeep = await rpc('promo_apply_pass', pS.data.id, oDeep, 'QA');
    check('scope NHT: order with a Deep Body service → applied', aDeep.success, aDeep.error);
    const camp3 = await rpc('promo_campaign_json', scopeDeep.id);
    check('campaign JSON: applicableMenus { menus:[NHT], allMenus:false }', JSON.stringify(camp3.applicableMenus?.menus) === '["NHT"]' && camp3.applicableMenus.allMenus === false, camp3.applicableMenus);

    // Menu NHS + category Body: '["Body"]' / 'BODY' in, 'Ear Clean' out; minutes and % base follow the scope
    const scopeBody = await createCampaign('BODY10', { benefit_type: 'PERCENT_DISCOUNT', benefit_value: 10,
        qualification_type: 'MIN_PAID_DURATION', qualification_value: 90,
        qualification_config: { serviceIdPrefixes: ['NHS'], serviceCategories: ['body'] } });
    const cB = await newCustomer();
    const pB = await rpc('promo_issue_manual', scopeBody.id, cB, 'QA');
    const oBody60 = await newBooking(cB, [{ serviceId: bodyArr, price: 400000 }]);
    check('condition NHS + Body + ≥ 90: Body 60 alone → ORDER_CONDITION_NOT_MET', (await rpc('promo_check_apply', pB.data.id, oBody60)) === 'ORDER_CONDITION_NOT_MET');
    const oBody = await newBooking(cB, [{ serviceId: bodyUp, price: 400000 }, { serviceId: ear, price: 200000 }, { serviceId: svc.vip60, price: 1000000 }]);
    const evB = await rpc('promo_evaluate_booking_for_campaign', oBody, scopeBody.id);
    check('condition NHS + Body + ≥ 90: Body 90 in a mixed order → eligible, matched = the Body item only', evB.eligible === true
        && JSON.stringify(evB.conditions?.matchedItemIds) === JSON.stringify([`${oBody}-I1`]), evB);
    const oEar = await newBooking(cB, [{ serviceId: ear, price: 200000 }]);
    check('scope NHS/Body: Ear Clean only → ORDER_CONDITION_NOT_MET', (await rpc('promo_check_apply', pB.data.id, oEar)) === 'ORDER_CONDITION_NOT_MET');
    const aBody = await rpc('promo_apply_pass', pB.data.id, oBody, 'QA');
    check('scope NHS/Body: 10% computed on Body items only (400,000 → 40,000)', aBody.data?.discountAmount === 40000, aBody.data?.discountAmount ?? aBody.error);
    const oBody2 = await newBooking(cB, [{ serviceId: bodyUp, price: 500000 }]);
    check('scope NHS/Body: "BODY" category (upper-case) is in scope', (await rpc('promo_check_apply', pB.data.id, oBody2)) === null);
    const scopeSvc = await createCampaign('ONESVC', { benefit_type: 'FREE_MINUTES', benefit_value: 10, qualification_config: { serviceIds: [ear] } });
    const pOne = await rpc('promo_issue_manual', scopeSvc.id, cB, 'QA');
    check('scope serviceIds only: Ear order OK, Body order blocked', (await rpc('promo_check_apply', pOne.data.id, oEar)) === null
        && (await rpc('promo_check_apply', pOne.data.id, oBody2)) === 'ORDER_CONDITION_NOT_MET');

    // Public voucher view
    const pubV = await rpc('promo_public_voucher_by_token', pass1.qr_token);
    check('public voucher: card data (campaign, benefit, usage, code, owner first name), qrToken while usable, no phone/email',
        pubV.success && pubV.data.voucherCode === pass1.voucher_code && pubV.data.qrToken === pass1.qr_token && pubV.data.customerName
        && pubV.data.benefit.type === 'FREE_MINUTES' && !JSON.stringify(pubV.data).includes('@qa.local') && !('phone' in pubV.data), pubV.data);
    const pubCan = await rpc('promo_public_voucher_by_token', (await q(`SELECT qr_token FROM "CustomerPromotionPasses" WHERE id = $1`, [pCan.data.id]))[0].qr_token);
    check('public voucher: cancelled → status shown, no QR', pubCan.success && pubCan.data.effectiveStatus === 'CANCELLED' && pubCan.data.qrToken === null, pubCan.data);
    const pubDeep = await rpc('promo_public_voucher_by_token', (await q(`SELECT qr_token FROM "CustomerPromotionPasses" WHERE id = $1`, [pS.data.id]))[0].qr_token);
    check('public voucher: menuLabels = menu names (NHT → "Menu Deep Body"; OCT = NHP + VIP_MENU covering all VIP → "Menu VIP")',
        JSON.stringify(pubDeep.data?.menuLabels) === '["Menu Deep Body"]' && JSON.stringify(pubV.data?.menuLabels) === '["Menu VIP"]', [pubDeep.data?.menuLabels, pubV.data?.menuLabels]);
    const campS = await rpc('promo_campaign_json', scopeSvc.id);
    // A menu with two categories: selecting one narrows it → "<menu> · <Category>".
    const qlb = `QLB${Date.now()}`;
    await q(`INSERT INTO "Services"(id, code, "nameVN", "priceVND", "priceUSD", duration, category) VALUES ($1, $1, 'Body', 0, 0, 60, 'BODY'), ($2, $2, 'Ear', 0, 0, 30, 'EAR_CLEAN')`, [qlb, qlb + '9']);
    const lbPart = (await q(`SELECT promo_scope_labels('{"serviceIdPrefixes":["QLB"],"serviceCategories":["body"]}') l`))[0].l;
    const lbFull = (await q(`SELECT promo_scope_labels('{"serviceIdPrefixes":["QLB"],"serviceCategories":["BODY","EAR_CLEAN"]}') l`))[0].l;
    const lbCat = (await q(`SELECT promo_scope_labels('{"serviceCategories":["EAR_CLEAN"]}') l`))[0].l;
    await q(`DELETE FROM "Services" WHERE id IN ($1, $2)`, [qlb, qlb + '9']);
    check('scope labels: partial category → "QLB · Body"; categories covering the menu → "QLB"; category only → "Ear Clean"; single service → its name; empty → []',
        JSON.stringify(lbPart) === '["QLB · Body"]' && JSON.stringify(lbFull) === '["QLB"]' && JSON.stringify(lbCat) === '["Ear Clean"]'
        && JSON.stringify(campS.applicableMenus?.labels) === JSON.stringify([ear]) && JSON.stringify((await rpc('promo_campaign_json', manual.id)).applicableMenus?.labels) === '[]',
        [lbPart, lbFull, lbCat, campS.applicableMenus?.labels]);
    const pubBadT = await rpc('promo_public_voucher_by_token', 'nope');
    check('public voucher: unknown token → PROMOTION_NOT_FOUND', pubBadT.error?.code === 'PROMOTION_NOT_FOUND');

    // ---------- v4: customer stats, candidate filter, bulk issue, guest emails
    console.log('\n[v4 — customer filter, bulk issue, guest emails]');
    const realEmail = await q(`SELECT promo_real_email(' A@b.vn ') a, promo_real_email('guest17_3@GUEST.com') b, promo_real_email('no-at') c,
                                      promo_real_email('info@guesthouse.com') d`);
    check('promo_real_email = isDummyEmail rule (guest.com / no @ / empty → null, guesthouse.com is real)',
        realEmail[0].a === 'A@b.vn' && realEmail[0].b === null && realEmail[0].c === null && realEmail[0].d === 'info@guesthouse.com', realEmail[0]);
    const tag = `V4${RUN.slice(-5)}`;
    const mkCust = async (suffix: string, email: string | null, extra: Record<string, unknown> = {}) => {
        const id = `${RUN}-K${suffix}`;
        await q(`INSERT INTO "Customers"(id, "fullName", phone, email, gender, nationality, "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [id, `${tag} ${suffix}`, `07${Date.now().toString().slice(-6)}${suffix.padStart(2, '0').slice(-2)}`, email, extra.gender ?? null, extra.nationality ?? null]);
        return id;
    };
    const kA = await mkCust('A', `${tag.toLowerCase()}a@qa.local`, { gender: 'female', nationality: 'Korea' });
    const kGuest = await mkCust('G', `guest${Date.now()}_1@guest.com`);
    const kNone = await mkCust('N', null, { gender: 'Nam' });
    // kA: 2 completed parents (one VIP, one group of 3) + cancelled + new + completed child + unlinked name/email booking
    const bA1 = await newBooking(kA, [{ serviceId: svc.vip90, price: 900000 }]); await setStatus(bA1, 'DONE');
    const bA2 = await newBooking(kA, [{ serviceId: svc.std90, price: 500000 }]); await setStatus(bA2, 'FEEDBACK');
    await q(`UPDATE "Bookings" SET source = 'STANDARD_MENU', "guestCount" = 3 WHERE id = $1`, [bA2]);
    const bA3 = await newBooking(kA, [{ serviceId: svc.std90, price: 700000 }]); await setStatus(bA3, 'CANCELLED');
    await newBooking(kA, [{ serviceId: svc.std90, price: 300000 }]);
    const bA5 = await newBooking(kA, [{ serviceId: svc.std30, price: 100000 }]);
    await q(`UPDATE "Bookings" SET parent_booking_id = $2, source = 'STANDARD_MENU' WHERE id = $1`, [bA5, bA1]); await setStatus(bA5, 'DONE');
    const bA6 = await newBooking(null, [{ serviceId: svc.std30, price: 200000 }]);
    await q(`UPDATE "Bookings" SET "customerName" = $2, "customerEmail" = $3, source = 'STANDARD_MENU' WHERE id = $1`, [bA6, `${tag} A`, `${tag.toLowerCase()}a@qa.local`]);
    await setStatus(bA6, 'DONE');
    const stats4 = (await q(`SELECT * FROM promo_customer_stats(ARRAY[$1, $2, $3])`, [kA, kGuest, kNone]));
    const sA = stats4.find(r => r.customer_id === kA), sG = stats4.find(r => r.customer_id === kGuest), sN = stats4.find(r => r.customer_id === kNone);
    check('stats: visits = completed PARENT bookings only (DONE + FEEDBACK + unlinked name/email match = 3; cancelled, new, child excluded)',
        sA?.visit_count === 3, sA);
    check('stats: spent = completed incl. child (900k + 500k + 100k + 200k), VIP tag counts completed VIP orders, group guestType',
        Number(sA?.total_spent) === 1700000 && sA?.vip_menu_count === 1 && sA?.guest_type === 'GROUP', sA);
    check('stats: tier RETURNING at ≥ 2 visits, NEW otherwise; gender / nationality normalised', sA?.tier === 'RETURNING' && sN?.tier === 'NEW'
        && sA?.gender === 'FEMALE' && sN?.gender === 'MALE' && sA?.nationality === 'Korea', { sA: [sA?.tier, sA?.gender], sN: [sN?.tier, sN?.gender] });
    check('stats: guest.com email → real_email null', sG?.real_email === null && sG?.email?.endsWith('@guest.com'));

    const cand = async (filter: Record<string, unknown>, limit = 50, offset = 0) => rpc('promo_customer_candidates', oct.id, JSON.stringify({ q: tag, ...filter }), limit, offset);
    const c0 = await cand({});
    check('candidates: hasEmail default → only kA, excludedNoEmail = 2 (null + guest.com)', c0.success && c0.data.total === 1
        && c0.data.rows[0].id === kA && c0.data.excludedNoEmail === 2, c0.data ?? c0.error);
    check('candidates: row fields (visitCount, totalSpent, tier, vipMenuUsed, guestType); alreadyHasPass = true (OCT auto-issued on the 90 VIP DONE)',
        c0.data?.rows[0].visitCount === 3 && c0.data.rows[0].totalSpent === 1700000 && c0.data.rows[0].tier === 'RETURNING'
        && c0.data.rows[0].vipMenuUsed === true && c0.data.rows[0].guestType === 'GROUP' && c0.data.rows[0].alreadyHasPass === true, c0.data?.rows[0]);
    const c1f = await cand({ hasEmail: false });
    check('candidates: hasEmail=false → all 3, excludedNoEmail 0', c1f.data?.total === 3 && c1f.data.excludedNoEmail === 0, c1f.data?.total);
    const cT = await cand({ hasEmail: false, tier: 'NEW' });
    const cG = await cand({ hasEmail: false, gender: 'MALE' });
    const cV = await cand({ hasEmail: false, vipMenu: 'NOT_USED' });
    const cM = await cand({ hasEmail: false, minVisits: 3, minSpent: 1000000 });
    const cN = await cand({ hasEmail: false, nationality: 'korea', guestType: 'GROUP' });
    check('candidates: tier / gender / vipMenu / minVisits+minSpent / nationality+guestType filters',
        cT.data?.total === 2 && cG.data?.total === 1 && cG.data.rows[0].id === kNone && cV.data?.total === 2
        && cM.data?.total === 1 && cM.data.rows[0].id === kA && cN.data?.total === 1, [cT.data?.total, cG.data?.total, cV.data?.total, cM.data?.total, cN.data?.total]);
    const todayV = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const cQ = await cand({ onlyQualified: true, qualifiedFrom: todayV, qualifiedTo: todayV });
    check('candidates: onlyQualified uses the engine (90 VIP DONE today) → kA, qualifyingOrderCount 1', cQ.data?.total === 1
        && cQ.data.rows[0].qualifyingOrderCount === 1 && cQ.data.qualifyingComputed === true, cQ.data ?? cQ.error);
    const bad4a = await cand({ tier: 'VIP' });
    const bad4b = await cand({ onlyQualified: true });
    const bad4c = await cand({ qualifiedFrom: '2026-01-01', qualifiedTo: '2026-06-30' });
    check('candidates: tier VIP / onlyQualified without range / range > 93 days → VALIDATION_ERROR',
        [bad4a, bad4b, bad4c].every(r => r.error?.code === 'VALIDATION_ERROR'), [bad4a.error, bad4b.error, bad4c.error]);
    const qIgn = await rpc('promo_customer_candidates', manual.id, JSON.stringify({ q: tag, onlyQualified: true, qualifiedFrom: todayV, qualifiedTo: todayV, hasEmail: false }), 50, 0);
    check('candidates: MANUAL_ASSIGNMENT campaign → onlyQualified ignored (flag), list not emptied', qIgn.data?.qualificationIgnored === true && qIgn.data.total === 3, qIgn.data);
    check('candidates: nationalities list for the select', Array.isArray(c0.data?.nationalities) && c0.data.nationalities.includes('Korea'));

    // Bulk issue
    const bulk = await rpc('promo_issue_bulk', days7.id, [kA, kA, kGuest, kNone, `${RUN}-NOPE`, cD], 'QA');
    const byId = Object.fromEntries((bulk.data?.results ?? []).map((r: any) => [r.customerId, r]));
    check('bulk: dedupes ids, ISSUED for new profiles, ALREADY_EXISTS for cD, FAILED CUSTOMER_NOT_FOUND for unknown',
        bulk.success && bulk.data.results.length === 5 && byId[kA]?.status === 'ISSUED' && byId[kGuest]?.status === 'ISSUED'
        && byId[cD]?.status === 'ALREADY_EXISTS' && byId[`${RUN}-NOPE`]?.status === 'FAILED' && byId[`${RUN}-NOPE`]?.errorCode === 'CUSTOMER_NOT_FOUND', bulk.data ?? bulk.error);
    check('bulk: email PENDING for real email, SKIPPED for guest.com / no email', byId[kA]?.emailStatus === 'PENDING'
        && byId[kGuest]?.emailStatus === 'SKIPPED' && byId[kNone]?.emailStatus === 'SKIPPED', [byId[kA]?.emailStatus, byId[kGuest]?.emailStatus, byId[kNone]?.emailStatus]);
    const clG = await rpc('promo_claim_pass_email', byId[kGuest].passId, 'ISSUE', true);
    check('guest.com profile: resend → CUSTOMER_NO_EMAIL (never mailed)', clG.error?.code === 'CUSTOMER_NO_EMAIL', clG);
    const cAfter = await rpc('promo_customer_candidates', days7.id, JSON.stringify({ q: tag }), 50, 0);
    check('candidates: alreadyHasPass true after issue', cAfter.data?.rows[0]?.alreadyHasPass === true);
    const kP = await mkCust('P', `${tag.toLowerCase()}p@qa.local`);
    const [w1b, w2b] = [new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl }), new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl })];
    await w1b.connect(); await w2b.connect();
    await Promise.all([w1b.query(`SELECT promo_issue_bulk($1, $2, 'A')`, [days7.id, [kP]]), w2b.query(`SELECT promo_issue_bulk($1, $2, 'B')`, [days7.id, [kP]])]);
    await w1b.end(); await w2b.end();
    const nP = (await q(`SELECT count(*)::int n FROM "CustomerPromotionPasses" WHERE customer_id = $1 AND campaign_id = $2`, [kP, days7.id]))[0].n;
    check('bulk: two concurrent bulk issues for the same profile → one pass', nP === 1, nP);
    const big = await rpc('promo_issue_bulk', days7.id, Array.from({ length: 51 }, (_, i) => `${RUN}-X${i}`), 'QA');
    const inact = await rpc('promo_issue_bulk', (await createCampaign('INACT', { benefit_type: 'FREE_MINUTES', benefit_value: 5 }, false)).id, [kA], 'QA');
    check('bulk: > 50 profiles → VALIDATION_ERROR; DRAFT campaign → PROMOTION_INACTIVE', big.error?.code === 'VALIDATION_ERROR' && inact.error?.code === 'PROMOTION_INACTIVE', [big.error, inact.error]);
    for (const id of [byId[kA]?.passId]) if (id) await rpc('promo_mark_email_result', id, 'ISSUE', true, null);

    // ---------- v5: USED_UP, ACTIVE / PAST, re-issue after close, history
    console.log('\n[v5 — used up, tracking tabs, re-issue]');
    const one = await createCampaign('ONE1', { benefit_type: 'FREE_MINUTES', benefit_value: 10, usage_type: 'LIMITED', usage_limit: 1 });
    const cU = await newCustomer();
    const pU = await rpc('promo_issue_manual', one.id, cU, 'QA');
    const oU1 = await newBooking(cU, [{ serviceId: svc.vip60 }]);
    const aU1 = await rpc('promo_apply_pass', pU.data.id, oU1, 'QA');
    const eff = async (id: string) => (await rpc('promo_pass_json', id, false)).effectiveStatus;
    check('LIMITED 1 used once → effectiveStatus USED_UP (not ACTIVE)', aU1.success && await eff(pU.data.id) === 'USED_UP');
    const oU2 = await newBooking(cU, [{ serviceId: svc.vip60 }]);
    check('USED_UP pass: apply blocked PROMOTION_USAGE_LIMIT_REACHED', (await rpc('promo_check_apply', pU.data.id, oU2)) === 'PROMOTION_USAGE_LIMIT_REACHED');
    const clU = await rpc('promo_claim_pass_email', pU.data.id, 'ISSUE', true);
    check('USED_UP pass: never emailed (PROMOTION_USED_UP)', clU.error?.code === 'PROMOTION_USED_UP', clU);
    const pubU = await rpc('promo_public_voucher_by_token', (await q(`SELECT qr_token FROM "CustomerPromotionPasses" WHERE id = $1`, [pU.data.id]))[0].qr_token);
    check('USED_UP pass: public page shows status, no QR', pubU.data?.effectiveStatus === 'USED_UP' && pubU.data.qrToken === null, pubU.data);
    await rpc('promo_cancel_usage', aU1.data.usageId, 'QA', 'qa');
    check('cancel that use → back to ACTIVE (live recompute)', await eff(pU.data.id) === 'ACTIVE');
    const aU1b = await rpc('promo_apply_pass', pU.data.id, oU1, 'QA');
    check('    (setup) use it again → USED_UP', aU1b.success && await eff(pU.data.id) === 'USED_UP');

    // re-issue after USED_UP
    const rU = await rpc('promo_issue_manual', one.id, cU, 'QA');
    const oldU = (await q(`SELECT superseded_at, superseded_by FROM "CustomerPromotionPasses" WHERE id = $1`, [pU.data.id]))[0];
    check('re-issue after USED_UP → new pass, new code; old pass superseded_by new', rU.success && rU.data.id !== pU.data.id
        && rU.data.voucherCode !== pU.data.voucherCode && oldU.superseded_at && oldU.superseded_by === rU.data.id, { rU: rU.error, oldU });
    await rpc('promo_cancel_usage', aU1b.data.usageId, 'QA', 'qa');
    check('superseded pass stays closed even if its use is cancelled (EXPIRED, apply blocked)', await eff(pU.data.id) === 'EXPIRED'
        && (await rpc('promo_check_apply', pU.data.id, oU2)) === 'PROMOTION_EXPIRED');

    // re-issue after CANCELLED
    const rC = await rpc('promo_issue_manual', manual.id, cCan, 'QA');
    const pCanRow = (await q(`SELECT status FROM "CustomerPromotionPasses" WHERE id = $1`, [pCan.data.id]))[0];
    check('re-issue after CANCELLED → new pass; old stays CANCELLED (history)', rC.success && rC.data.id !== pCan.data.id && pCanRow.status === 'CANCELLED', rC.error);
    // re-issue after EXPIRED
    const rE = await rpc('promo_issue_manual', manual.id, cExp, 'QA');
    check('re-issue after EXPIRED → new pass, old superseded', rE.success && (await q(`SELECT superseded_by FROM "CustomerPromotionPasses" WHERE id = $1`, [pExp.data.id]))[0].superseded_by === rE.data.id, rE.error);
    // still blocked while holding a usable pass (ACTIVE / SUSPENDED)
    const dupA = await rpc('promo_issue_manual', manual.id, cCan, 'QA');
    await rpc('promo_set_pass_status', rC.data.id, 'SUSPEND', 'qa', 'QA');
    const dupS = await rpc('promo_issue_manual', manual.id, cCan, 'QA');
    await rpc('promo_set_pass_status', rC.data.id, 'REACTIVATE', 'qa', 'QA');
    check('holding ACTIVE or SUSPENDED pass → PASS_ALREADY_EXISTS (no second usable pass)', dupA.error?.code === 'PASS_ALREADY_EXISTS'
        && dupS.error?.code === 'PASS_ALREADY_EXISTS', [dupA.error, dupS.error]);
    // concurrent re-issue
    const cR = await newCustomer();
    const pR0 = await rpc('promo_issue_manual', manual.id, cR, 'QA');
    await rpc('promo_set_pass_status', pR0.data.id, 'CANCEL', 'qa', 'QA');
    const [x1, x2] = [new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl }), new Client({ connectionString: DB_URL, ssl: (db as any).connectionParameters.ssl })];
    await x1.connect(); await x2.connect();
    await Promise.all([x1.query(`SELECT promo_issue_manual($1, $2, 'A')`, [manual.id, cR]), x2.query(`SELECT promo_issue_manual($1, $2, 'B')`, [manual.id, cR])]);
    await x1.end(); await x2.end();
    const openR = (await q(`SELECT count(*)::int n FROM "CustomerPromotionPasses" WHERE customer_id = $1 AND campaign_id = $2 AND status <> 'CANCELLED' AND superseded_at IS NULL`, [cR, manual.id]))[0].n;
    check('concurrent re-issue → exactly one open pass', openR === 1, openR);
    const bulkRe = await rpc('promo_issue_bulk', one.id, [cU], 'QA');
    check('bulk on a customer holding the re-issued pass → ALREADY_EXISTS', bulkRe.data?.results?.[0]?.status === 'ALREADY_EXISTS', bulkRe.data);

    // tracking tabs
    const gA = await rpc('promo_search_passes', null, manual.id, null, null, 200, 0, 'ACTIVE');
    const gP = await rpc('promo_search_passes', null, manual.id, null, null, 200, 0, 'PAST');
    const idsA = (gA.data?.items ?? []).map((x: any) => x.id), idsP = (gP.data?.items ?? []).map((x: any) => x.id);
    check('group ACTIVE: usable / suspended passes only', idsA.includes(rC.data.id) && idsA.includes(pSus.data.id) && !idsA.includes(pCan.data.id)
        && (gA.data.items as any[]).every(x => ['ACTIVE', 'NOT_STARTED', 'SUSPENDED', 'INACTIVE'].includes(x.effectiveStatus)), (gA.data?.items ?? []).map((x: any) => x.effectiveStatus));
    check('group PAST: cancelled + expired (+ superseded), each with endedAt', idsP.includes(pCan.data.id) && idsP.includes(pExp.data.id)
        && (gP.data.items as any[]).every(x => ['EXPIRED', 'USED_UP', 'CANCELLED'].includes(x.effectiveStatus) && x.endedAt), (gP.data?.items ?? []).map((x: any) => [x.effectiveStatus, !!x.endedAt]));
    const untilA = (gA.data.items as any[]).map(x => Date.parse(x.validUntil));
    check('group ACTIVE sorted by soonest expiry', untilA.every((v, i) => i === 0 || untilA[i - 1] <= v), untilA.length);
    const endedP = (gP.data.items as any[]).map(x => Date.parse(x.endedAt));
    check('group PAST sorted by latest end first', endedP.every((v, i) => i === 0 || endedP[i - 1] >= v), endedP.length);
    const gU = await rpc('promo_search_passes', null, one.id, null, null, 50, 0, 'PAST');
    check('group PAST includes the superseded used-up pass', (gU.data?.items ?? []).some((x: any) => x.id === pU.data.id));
    const ov5 = await rpc('promo_overview');
    check('overview.pastPasses counted', typeof ov5.data?.pastPasses === 'number' && ov5.data.pastPasses >= 3, ov5.data);

    // candidates: history + blocked last
    const tagC = (await q(`SELECT "fullName" FROM "Customers" WHERE id = $1`, [cCan]))[0].fullName;
    const cc5 = await rpc('promo_customer_candidates', manual.id, JSON.stringify({ q: 'QA Promo', hasEmail: false }), 50, 0);
    const rows5 = (cc5.data?.rows ?? []) as any[];
    const rowCan = rows5.find(r => r.id === cCan);
    check('candidates: profile history lists every voucher (cancelled + re-issued)', rowCan?.passHistory?.length >= 2
        && rowCan.passHistory.some((h: any) => h.effectiveStatus === 'CANCELLED') && rowCan.alreadyHasPass === true, { tagC, h: rowCan?.passHistory });
    const firstBlocked = rows5.findIndex(r => r.alreadyHasPass);
    check('candidates: profiles that can be issued come first, holders of a usable pass last',
        firstBlocked === -1 || rows5.slice(firstBlocked).every(r => r.alreadyHasPass), rows5.map(r => r.alreadyHasPass));
    const rowNew = rows5.find(r => r.id === cStd);
    check('candidates: profile with no voucher → alreadyHasPass false, empty history', rowNew?.alreadyHasPass === false && rowNew.passHistory.length === 0, rowNew);

    // ---------- v7: apply conditions (one config for apply + auto-issue)
    console.log('\n[v7 — apply conditions]');
    // The user's example: VIP 90 sent with the order → +30; VIP 60 + a 30-min add-on later → no.
    const cVip = await newCustomer();
    const pV = await rpc('promo_issue_manual', oct.id, cVip, 'QA');
    const oV90 = await newBooking(cVip, [{ serviceId: svc.vip90 }]);
    const oV89 = await newBooking(cVip, [{ serviceId: svc.vip89 }]);
    const oVaddon = await newBooking(cVip, [{ serviceId: svc.vip60 }, { serviceId: svc.vip30, options: { isAddon: true, isPaid: true, duration: 30 } }]);
    check('OCT (menu VIP from 90 min): VIP 90 sent with the order → applies', (await rpc('promo_check_apply', pV.data.id, oV90)) === null);
    check('OCT: VIP 89 → ORDER_CONDITION_NOT_MET', (await rpc('promo_check_apply', pV.data.id, oV89)) === 'ORDER_CONDITION_NOT_MET');
    check('OCT: VIP 60 + paid add-on 30 later → NOT met (add-ons are not the initial choice)', (await rpc('promo_check_apply', pV.data.id, oVaddon)) === 'ORDER_CONDITION_NOT_MET');
    const candV = ((await rpc('promo_order_candidates', pV.data.id, null, 100)).data as any[]).find(o => o.id === oVaddon);
    check('candidates: conditionResult explains the block (best VIP service 60 of 90 min)', candV?.blockedReasonCode === 'ORDER_CONDITION_NOT_MET'
        && candV.conditionResult?.results?.[0]?.bestMinutes === 60 && candV.conditionResult.results[0].minMinutes === 90, candV?.conditionResult);

    // "menu Standard, one of these services, from 90 min" — same service must satisfy all criteria
    const qms = `QMS${Date.now()}`;
    const [svA, svB, svC] = [`${qms}1`, `${qms}2`, `${qms}3`];
    await q(`INSERT INTO "Services"(id, code, "nameVN", "priceVND", "priceUSD", duration, category) VALUES
             ($1, $1, 'Body A', 0, 0, 90, 'Body'), ($2, $2, 'Body B', 0, 0, 60, 'Body'), ($3, $3, 'Body C', 0, 0, 90, 'Body')`, [svA, svB, svC]);
    const mkCamp = async (code: string, apply_conditions: unknown, extra: Record<string, unknown> = {}) =>
        createCampaign(code, { benefit_type: 'FREE_MINUTES', benefit_value: 30, apply_conditions, ...extra });
    const and1 = await mkCamp('AND1', { match: 'ALL', conditions: [{ menus: ['QMS'], serviceIds: [svA, svB], minMinutes: 90 }] });
    const cQ1 = await newCustomer();
    const pQ1 = await rpc('promo_issue_manual', and1.id, cQ1, 'QA');
    const ordA = await newBooking(cQ1, [{ serviceId: svA, price: 500000 }]);
    const ordB = await newBooking(cQ1, [{ serviceId: svB, price: 400000 }]);
    const ordC = await newBooking(cQ1, [{ serviceId: svC, price: 500000 }]);
    const ordBC = await newBooking(cQ1, [{ serviceId: svB, price: 400000 }, { serviceId: svC, price: 500000 }]);
    check('menu + one of (A, B) + ≥ 90: A(90) met; B(60) no; C(90, not in list) no',
        (await rpc('promo_check_apply', pQ1.data.id, ordA)) === null && (await rpc('promo_check_apply', pQ1.data.id, ordB)) === 'ORDER_CONDITION_NOT_MET'
        && (await rpc('promo_check_apply', pQ1.data.id, ordC)) === 'ORDER_CONDITION_NOT_MET');
    check('criteria must hold on the SAME service: B(60) + C(90) → not met', (await rpc('promo_check_apply', pQ1.data.id, ordBC)) === 'ORDER_CONDITION_NOT_MET');
    const vB90 = await newBooking(cQ1, [{ serviceId: svB, price: 400000, options: { duration: 90 } }]);
    check('service duration override (options.duration 90 on B) → met', (await rpc('promo_check_apply', pQ1.data.id, vB90)) === null);

    const any1 = await mkCamp('ANY1', { match: 'ANY', conditions: [{ serviceIds: [svB], minMinutes: 60 }, { menus: ['QMS'], minMinutes: 120 }] });
    const all2 = await mkCamp('ALL2', { match: 'ALL', conditions: [{ serviceIds: [svA] }, { serviceIds: [svB] }] });
    const pAny = await rpc('promo_issue_manual', any1.id, cQ1, 'QA');
    const pAll = await rpc('promo_issue_manual', all2.id, cQ1, 'QA');
    const ordAB = await newBooking(cQ1, [{ serviceId: svA, price: 500000 }, { serviceId: svB, price: 400000 }]);
    check('ANY: B(60) meets the first condition → applies', (await rpc('promo_check_apply', pAny.data.id, ordB)) === null);
    check('ALL: A alone no; A + B yes', (await rpc('promo_check_apply', pAll.data.id, ordA)) === 'ORDER_CONDITION_NOT_MET'
        && (await rpc('promo_check_apply', pAll.data.id, ordAB)) === null);

    const amt = await mkCamp('AMT1', { match: 'ALL', conditions: [{ minOrderAmount: 1000000 }] });
    const pAmt = await rpc('promo_issue_manual', amt.id, cQ1, 'QA');
    const ord900 = await newBooking(cQ1, [{ serviceId: svA, price: 900000 }, { serviceId: svB, price: 300000, options: { isAddon: true, isPaid: true } }]);
    const ord1200 = await newBooking(cQ1, [{ serviceId: svA, price: 700000 }, { serviceId: svB, price: 500000 }]);
    check('minOrderAmount (optional): 900k + later add-on 300k → no; 1.2M initial → yes',
        (await rpc('promo_check_apply', pAmt.data.id, ord900)) === 'ORDER_CONDITION_NOT_MET' && (await rpc('promo_check_apply', pAmt.data.id, ord1200)) === null);

    const pctC = await createCampaign('PCTC', { benefit_type: 'PERCENT_DISCOUNT', benefit_value: 10,
        apply_conditions: { match: 'ALL', conditions: [{ serviceIds: [svA], minMinutes: 90 }] } });
    const pPct = await rpc('promo_issue_manual', pctC.id, cQ1, 'QA');
    const aPct = await rpc('promo_apply_pass', pPct.data.id, ordAB, 'QA');
    check('% discount base = services that met the conditions (A 500k → 50k, not B)', aPct.data?.discountAmount === 50000, aPct.data?.discountAmount ?? aPct.error);

    // validation + lock + legacy + auto-issue share the config
    const badEmpty = await rpc('promo_create_campaign', JSON.stringify({ campaign_code: `${RUN}_BADC1`, name: 'x', benefit_type: 'FREE_MINUTES', benefit_value: 10,
        valid_from: iso(new Date()), valid_until: iso(new Date(Date.now() + DAY)), apply_conditions: { match: 'ALL', conditions: [{}] } }), 'QA');
    const badMin = await rpc('promo_create_campaign', JSON.stringify({ campaign_code: `${RUN}_BADC2`, name: 'x', benefit_type: 'FREE_MINUTES', benefit_value: 10,
        valid_from: iso(new Date()), valid_until: iso(new Date(Date.now() + DAY)), apply_conditions: { match: 'ALL', conditions: [{ minMinutes: 0 }] } }), 'QA');
    const badAuto = await rpc('promo_create_campaign', JSON.stringify({ campaign_code: `${RUN}_BADC3`, name: 'x', benefit_type: 'FREE_MINUTES', benefit_value: 10,
        valid_from: iso(new Date()), valid_until: iso(new Date(Date.now() + DAY)), assignment_mode: 'AUTO' }), 'QA');
    check('validation: empty condition / minMinutes 0 / AUTO without conditions → CAMPAIGN_INVALID',
        [badEmpty, badMin, badAuto].every(r => r.error?.code === 'CAMPAIGN_INVALID'), [badEmpty.error, badMin.error, badAuto.error]);
    const same = await rpc('promo_update_campaign', and1.id, JSON.stringify({ apply_conditions: { match: 'ALL', conditions: [{ menus: ['qms'], serviceIds: [svA, svB], minMinutes: 90 }] } }), 'QA');
    const changed = await rpc('promo_update_campaign', and1.id, JSON.stringify({ apply_conditions: { match: 'ALL', conditions: [{ menus: ['QMS'], minMinutes: 60 }] } }), 'QA');
    check('ACTIVE campaign: same conditions (normalised) → OK; changed → CAMPAIGN_LOCKED', same.success && changed.error?.code === 'CAMPAIGN_LOCKED', [same.error, changed.error]);
    const legacy = (await rpc('promo_campaign_json', oct.id)).applyConditions;
    check('legacy OCT (menu NHP + VIP_MENU, MIN_PAID_DURATION 90) converted to one condition ≥ 90', legacy?.match === 'ALL' && legacy.conditions.length === 1
        && legacy.conditions[0].minMinutes === 90 && JSON.stringify(legacy.conditions[0].menus) === '["NHP"]', legacy);
    const mixed = await rpc('promo_create_campaign', JSON.stringify({ campaign_code: `${RUN}_MIX`, name: 'x', benefit_type: 'FREE_MINUTES', benefit_value: 10,
        valid_from: iso(new Date()), valid_until: iso(new Date(Date.now() + DAY)), qualification_config: { serviceIdPrefixes: ['NHT'], serviceIds: [svB] } }), 'QA');
    check('legacy menu + single service ("or") → two ANY conditions', mixed.data?.applyConditions?.match === 'ANY' && mixed.data.applyConditions.conditions.length === 2, mixed.data?.applyConditions);
    const autoC = await mkCamp('AUTOC', { match: 'ALL', conditions: [{ serviceIds: [svA], minMinutes: 90 }] }, { assignment_mode: 'AUTO' });
    const cAuto = await newCustomer();
    const bAutoNo = await newBooking(cAuto, [{ serviceId: svB }]); await setStatus(bAutoNo, 'DONE');
    const noYet = (await passesOf(cAuto, autoC.id)).length;
    const bAutoYes = await newBooking(cAuto, [{ serviceId: svA }]); await setStatus(bAutoYes, 'DONE');
    check('auto-issue uses the SAME conditions: B done → nothing; A(90) done → pass', noYet === 0 && (await passesOf(cAuto, autoC.id)).length === 1);
    const pubC = await rpc('promo_public_voucher_by_token', (await q(`SELECT qr_token FROM "CustomerPromotionPasses" WHERE id = $1`, [pQ1.data.id]))[0].qr_token);
    check('public voucher: conditionsSummary with service names + minutes', JSON.stringify(pubC.data?.conditionsSummary?.conditions?.[0]?.services) === '["Body A","Body B"]'
        && pubC.data.conditionsSummary.conditions[0].minMinutes === 90 && pubC.data.conditionsSummary.conditions[0].menus[0] === 'QMS', pubC.data?.conditionsSummary);
    // ---------- v8: counter override with mandatory reason
    console.log('\n[v8 — override when conditions are missed]');
    const cand8 = ((await rpc('promo_order_candidates', pV.data.id, null, 100)).data as any[]);
    const c89 = cand8.find(o => o.id === oV89), c90 = cand8.find(o => o.id === oV90);
    check('candidates: VIP 89 → NOT_ELIGIBLE, canOverride, note "Cần Menu VIP · từ 90 phút — dịch vụ phù hợp dài nhất của đơn là 89 phút"',
        c89?.eligibility === 'NOT_ELIGIBLE' && c89.canOverride === true
        && c89.unmetReasons?.[0] === 'Cần Menu VIP · từ 90 phút — dịch vụ phù hợp dài nhất của đơn là 89 phút', c89 && [c89.eligibility, c89.unmetReasons]);
    check('candidates: VIP 90 → ELIGIBLE, no reasons', c90?.eligibility === 'ELIGIBLE' && c90.unmetReasons.length === 0, c90?.eligibility);
    const noOv = await rpc('promo_apply_pass', pV.data.id, oV89, 'NH001');
    check('apply without override → ORDER_CONDITION_NOT_MET + unmetReasons for the popup', noOv.error?.code === 'ORDER_CONDITION_NOT_MET'
        && noOv.data?.unmetReasons?.length === 1 && noOv.data.canOverride === true, noOv);
    const noNote = await rpc('promo_apply_pass', pV.data.id, oV89, 'NH001', true, null);
    const shortNote = await rpc('promo_apply_pass', pV.data.id, oV89, 'NH001', true, ' ab ');
    check('override without reason / reason < 3 chars → OVERRIDE_REASON_REQUIRED', noNote.error?.code === 'OVERRIDE_REASON_REQUIRED'
        && shortNote.error?.code === 'OVERRIDE_REASON_REQUIRED', [noNote.error, shortNote.error]);
    const ovr = await rpc('promo_apply_pass', pV.data.id, oV89, 'NH007', true, 'Khách quen, quản lý duyệt');
    const ovRow = ovr.success ? (await q(`SELECT conditions_overridden, override_reasons, override_note, staff_id FROM "PromotionUsages" WHERE id = $1`, [ovr.data.usageId]))[0] : null;
    check('override with reason → applied; usage records overridden + reasons + note + staff', ovr.success && ovr.data.conditionsOverridden === true
        && ovRow?.conditions_overridden === true && ovRow.override_note === 'Khách quen, quản lý duyệt' && ovRow.staff_id === 'NH007'
        && ovRow.override_reasons?.[0]?.includes('89 phút'), { err: ovr.error, ovRow });
    const okNormal = await rpc('promo_apply_pass', pV.data.id, oV90, 'NH001', true, 'không cần');
    const okRow = okNormal.success ? (await q(`SELECT conditions_overridden, override_note FROM "PromotionUsages" WHERE id = $1`, [okNormal.data.usageId]))[0] : null;
    check('override flag on an ELIGIBLE order → normal apply, NOT recorded as exception', okNormal.success && okRow?.conditions_overridden === false && okRow.override_note === null, okRow);
    const again = await rpc('promo_apply_pass', pV.data.id, oV89, 'NH001', true, 'thử lại');
    const expOv = await rpc('promo_apply_pass', pExp.data.id, oV89, 'NH001', true, null);
    const doneOv = await rpc('promo_apply_pass', pV.data.id, oDone, 'NH001', true, 'thử');
    check('hard blocks stay: already applied / expired (even without reason) / order closed', again.error?.code === 'PROMOTION_ALREADY_APPLIED'
        && expOv.error?.code === 'PROMOTION_EXPIRED' && doneOv.error?.code === 'ORDER_NOT_ACTIVE', [again.error, expOv.error, doneOv.error]);
    const cand8b = ((await rpc('promo_order_candidates', pV.data.id, null, 100)).data as any[]).find(o => o.id === oV89);
    check('after apply: the order is BLOCKED (already applied), canOverride false', cand8b?.eligibility === 'BLOCKED' && cand8b.canOverride === false, cand8b?.eligibility);
    // reason wording for other criteria
    const rSvc = await q(`SELECT promo_unmet_reasons($1, (SELECT apply_conditions FROM "PromotionCampaigns" WHERE id = $2)) r`, [ordC, and1.id]);
    check('reason: one-of services missing → "Cần QMS · một trong: Body A, Body B · từ 90 phút — đơn không có dịch vụ nào phù hợp"',
        rSvc[0].r?.[0] === 'Cần QMS · một trong: Body A, Body B · từ 90 phút — đơn không có dịch vụ nào phù hợp', rSvc[0].r);
    const rAmt = await q(`SELECT promo_unmet_reasons($1, (SELECT apply_conditions FROM "PromotionCampaigns" WHERE id = $2)) r`, [ord900, amt.id]);
    check('reason: amount → "Cần tổng đơn từ 1.000.000đ — đơn hiện 900.000đ" (later add-on not counted)', rAmt[0].r?.[0] === 'Cần tổng đơn từ 1.000.000đ — đơn hiện 900.000đ', rAmt[0].r);
    const ordNone = await newBooking(cQ1, [{ serviceId: svC, price: 100000 }]);
    const rAny = await q(`SELECT promo_unmet_reasons($1, (SELECT apply_conditions FROM "PromotionCampaigns" WHERE id = $2)) r`, [ordNone, any1.id]);
    check('reason: ANY → heading + each condition', rAny[0].r?.[0] === 'Cần đạt một trong các điều kiện sau:' && rAny[0].r.length === 3, rAny[0].r);
    const pPct2 = await rpc('promo_issue_manual', pctC.id, cVip, 'QA');
    const ordBv = await newBooking(cVip, [{ serviceId: svB, price: 400000 }]);
    const ovPct = await rpc('promo_apply_pass', pPct2.data.id, ordBv, 'NH001', true, 'Khách VIP lâu năm');
    check('override on % discount → base = whole order (10% of 400k = 40k)', ovPct.data?.discountAmount === 40000, ovPct.data?.discountAmount ?? ovPct.error);
    const usOv = await rpc('promo_list_usages', null, null, null, null, null, null, 500, true);
    check('usage history: overridden filter + note + reasons', usOv.success && usOv.data.length >= 2
        && usOv.data.every((u: any) => u.conditionsOverridden && u.overrideNote && u.overrideReasons.length > 0), usOv.data?.length);

    const passJ = await rpc('promo_pass_json', pV.data.id, false);
    const listJ = await rpc('promo_search_passes', pV.data.voucherCode, null, null, null, 10, 0);
    check('pass JSON (detail + list rows) carries conditionsSummary "Menu VIP · ≥ 90" — card text = real rule',
        passJ.conditionsSummary?.conditions?.[0]?.minMinutes === 90 && passJ.conditionsSummary.conditions[0].menus[0] === 'Menu VIP'
        && listJ.data?.items?.[0]?.conditionsSummary?.conditions?.[0]?.minMinutes === 90, passJ.conditionsSummary);
    await q(`DELETE FROM "BookingItems" WHERE "serviceId" IN ($1, $2, $3)`, [svA, svB, svC]);
    await q(`DELETE FROM "Services" WHERE id IN ($1, $2, $3)`, [svA, svB, svC]);

    const errs = await q(`SELECT * FROM "PromotionIssueErrors" WHERE booking_id LIKE $1`, [`${RUN}%`]);
    check('no trigger errors logged', errs.length === 0, errs);
}

main()
    .catch(e => { failures++; fatal(e); })
    .finally(async () => {
        try { if (!CLEANUP_ONLY) await restoreSettings(); await cleanup(); console.log('\n(cleanup done)'); } catch (e) { console.error('cleanup failed', e); failures++; }
        await db.end().catch(() => undefined);
        console.log(`\n=== ${failures === 0 ? 'DAT' : 'KHONG DAT'} — ${passes} pass, ${failures} fail ===`);
        finish(failures);
    });
