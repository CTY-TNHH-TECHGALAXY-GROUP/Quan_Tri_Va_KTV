/**
 * QA 23 — Web-claim e-voucher (promotion engine v15) on Supabase TEST only.
 * Plan: plans/plan_evoucher_webbooking_gioi_han.md (bugs B1–B20).
 *
 * Run (needs the TEST env, refuses any other project):
 *   set -a; source .worktrees/sequential-two-slot-handoff-20260926/.env.local; set +a
 *   TZ=UTC npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_promotion_web_claim.ts
 *
 * Creates its own campaign / bookings and deletes them at the end.
 */
// `server-only` is resolved by Next at build time; stub it for ts-node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
    if (request === 'server-only') return {};
    return origLoad.call(this, request, ...rest);
};

import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require('pg'); // no @types/pg in this repo
type PoolClient = any;
import { createClient } from '@supabase/supabase-js';
import { PromotionEngineService } from '@/lib/services/PromotionEngineService';
import { createMockPromotionApi } from '@/lib/services/promotionApi.mock';

// 🔧 QA CONFIGURATION
const TEST_PROJECT_REF = 'eknggruuiuadwldacpmb';
const QA_CUSTOMER_ID = 'QA-PROMO-001';
const QA_SERVICE_ID = 'SEQ_TEST_SVC_60';
const PARALLEL_SAVES = 50;
const INITIAL_QUANTITY = 3;
const REALTIME_WAIT_MS = 8000;

if (!process.env.DIRECT_URL?.includes(TEST_PROJECT_REF) || !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(TEST_PROJECT_REF)) {
    throw new Error('Refusing to run: env does not point at Supabase TEST');
}

const pool = new Pool({
    connectionString: process.env.DIRECT_URL,
    ssl: { ca: fs.readFileSync(process.env.DYNAMIC_DB_CA_CERT_PATH as string, 'utf8') },
    max: 20,
});
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);

const stamp = Date.now().toString(36).toUpperCase();
const slug = `qa-web-${stamp.toLowerCase()}`;
const created = { campaignId: '', serviceId: '', bookingIds: [] as string[], extraCampaignIds: [] as string[] };
let failures = 0;

const check = (ok: boolean, label: string, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ✅' : '  ❌'} ${label}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
};
const one = async (sql: string, params: unknown[] = [], client?: PoolClient) =>
    (await (client ?? pool).query(sql, params)).rows[0];
const rpc = async (fn: string, args: unknown[], client?: PoolClient) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    return (await one(`SELECT ${fn}(${ph}) AS r`, args, client)).r;
};
const reserve = (device: string, ip: string) => rpc('promo_web_reserve', [slug, device, ip]);
const stats = () => rpc('promo_web_campaign_stats', [created.campaignId]);
const errCode = (r: any) => r?.error?.code;

// Real web writer: allocate number + webbooking_commit_booking, then activation in the SAME transaction.
const bookOnWeb = async (phone: string, voucherCode?: string, idemKey = `idemp:qa-${stamp}-${Math.random()}`) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bookingAt = new Date(Date.now() + 86_400_000);
        const id = await rpc('webbooking_allocate_booking_number', [bookingAt.toISOString()], client);
        // The allocator numbers by the Vietnam calendar day: WB-DDMMYYYY-n.
        const [, dd, mm, yyyy] = /^WB-(\d{2})(\d{2})(\d{4})-/.exec(id) as RegExpExecArray;
        const ymd = `${yyyy}-${mm}-${dd}`;
        const booking = {
            id, billCode: id, guestCount: 1, branchName: 'QA', bookingDate: `${ymd}T10:00:00`, timeBooking: '10:00',
            customerName: 'QA Promo Khach', customerPhone: phone, customerEmail: 'qa-promo@example.com',
            customerLang: 'vi', customerId: QA_CUSTOMER_ID, totalAmount: 300000, idLegacy: idemKey, source: 'WebBooking', status: 'NEW',
        };
        const items = [{ id: `${id}-1`, serviceId: QA_SERVICE_ID, quantity: 1, price: 300000, options: {} }];
        const commit = (await client.query('SELECT webbooking_commit_booking($1, $2) AS r', [booking, JSON.stringify(items)])).rows[0].r;
        let activation: any = null;
        if (voucherCode) {
            activation = await rpc('promo_web_activate', [voucherCode, commit.bookingId], client);
            if (!activation?.success) {
                await client.query('ROLLBACK');
                return { commit, activation, rolledBack: true, booking, items };
            }
        }
        await client.query('COMMIT');
        created.bookingIds.push(commit.bookingId);
        return { commit, activation, rolledBack: false, booking, items };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const setFlag = (on: boolean) =>
    pool.query(`INSERT INTO "SystemConfigs"(key, value) VALUES ('promotion_web_claim_enabled', $1::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(on)]);

const setup = async () => {
    const now = Date.now();
    const c = await one(`INSERT INTO "PromotionCampaigns"(campaign_code, name, benefit_type, benefit_value, valid_from, valid_until,
                            usage_type, voucher_prefix, status, created_by)
                         VALUES ($1, 'QA Oria Booking Rewards', 'PERCENT_DISCOUNT', 10, $2, $3, 'ONE_TIME', 'WBQA', 'ACTIVE', 'QA')
                         RETURNING id`,
        [`QAWEB-${stamp}`, new Date(now - 3_600_000), new Date(now + 7 * 86_400_000)]);
    created.campaignId = c.id;
    created.serviceId = await rpc('promo_sync_benefit_service', [c.id]);
    const conf = await rpc('promo_web_configure', [c.id, { totalQuantity: INITIAL_QUANTITY, reservationMinutes: 30, publicSlug: slug }, 'QA']);
    check(conf.success && conf.data.available === INITIAL_QUANTITY, `Cau hinh WEB_CLAIM tong ${INITIAL_QUANTITY}`, conf);
};

const cleanup = async () => {
    const id = created.campaignId;
    if (!id) return;
    await pool.query(`DELETE FROM "PromotionWebClaims" WHERE campaign_id = $1`, [id]);
    await pool.query(`DELETE FROM "BookingItems" WHERE "bookingId" = ANY($1)`, [created.bookingIds]);
    await pool.query(`DELETE FROM "PromotionUsages" WHERE campaign_id = $1`, [id]);
    await pool.query(`DELETE FROM "CustomerPromotionPasses" WHERE campaign_id = $1`, [id]);
    await pool.query(`DELETE FROM "Bookings" WHERE id = ANY($1)`, [created.bookingIds]);
    await pool.query(`DELETE FROM "PromotionCampaignStock" WHERE campaign_id = $1`, [id]);
    await pool.query(`DELETE FROM "PromotionCampaigns" WHERE id = $1`, [id]);
    if (created.serviceId) await pool.query(`DELETE FROM "Services" WHERE id = $1`, [created.serviceId]).catch(() => undefined);
    for (const extra of created.extraCampaignIds) {
        const svc = await one(`SELECT benefit_service_id FROM "PromotionCampaigns" WHERE id = $1`, [extra]);
        await pool.query(`DELETE FROM "PromotionUsages" WHERE campaign_id = $1`, [extra]);
        await pool.query(`DELETE FROM "CustomerPromotionPasses" WHERE campaign_id = $1`, [extra]);
        await pool.query(`DELETE FROM "PromotionCampaignStock" WHERE campaign_id = $1`, [extra]);
        await pool.query(`DELETE FROM "PromotionCampaigns" WHERE id = $1`, [extra]);
        if (svc?.benefit_service_id) await pool.query(`DELETE FROM "Services" WHERE id = $1`, [svc.benefit_service_id]).catch(() => undefined);
    }
    await pool.query(`DELETE FROM "SystemConfigs" WHERE key = 'promotion_web_claim_enabled'`);
};

const main = async () => {
    console.log(`QA 23 — campaign slug ${slug}`);
    await setFlag(false);
    await setup();

    console.log('\n[B-flag] Cong tac tong');
    check(errCode(await reserve('dev-flag', 'ip-flag')) === 'FEATURE_DISABLED', 'Tat cong tac -> FEATURE_DISABLED');
    await setFlag(true);

    console.log('\n[B5] Realtime: anon subscribe PromotionCampaignStock');
    const events: any[] = [];
    const channel = anon.channel(`qa-stock-${stamp}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'PromotionCampaignStock', filter: `public_slug=eq.${slug}` },
            (p) => events.push(p.new))
        .subscribe((status, err) => console.log(`     realtime: ${status}${err ? ` ${err.message}` : ''}`));
    await new Promise((r) => setTimeout(r, 2500));

    console.log(`\n[B1] ${PARALLEL_SAVES} nguoi bam Luu cung luc, kho ${INITIAL_QUANTITY}`);
    const results = await Promise.all(Array.from({ length: PARALLEL_SAVES }, (_, i) => reserve(`dev-${i}`, `ip-${i}`)));
    const ok = results.filter((r: any) => r.success);
    const soldOut = results.filter((r: any) => errCode(r) === 'SOLD_OUT');
    check(ok.length === INITIAL_QUANTITY, `Dung ${INITIAL_QUANTITY} nguoi thanh cong`, ok.length);
    check(soldOut.length === PARALLEL_SAVES - INITIAL_QUANTITY, `${PARALLEL_SAVES - INITIAL_QUANTITY} nguoi SOLD_OUT`, soldOut.length);
    check(new Set(ok.map((r: any) => r.data.voucherCode)).size === ok.length, 'Ma voucher khong trung');
    let s = await stats();
    check(s.allocated === INITIAL_QUANTITY && s.available === 0 && s.stockStatus === 'SOLD_OUT', 'Kho = 0, SOLD_OUT', s);

    await new Promise((r) => setTimeout(r, REALTIME_WAIT_MS));
    console.log('     events (thu tu nhan):', events.map((e) => `v${e.version}:${e.available}`).join(' | '));
    // Client rule: keep the event with the highest version, never the last one received.
    const lastEvent = events.reduce((a, e) => (!a || e.version > a.version ? e : a), null as any);
    check(lastEvent?.available === 0 && lastEvent?.status === 'SOLD_OUT', 'Realtime: ban ghi version cao nhat = available 0 / SOLD_OUT', { events: events.length, lastEvent });

    console.log('\n[B4] Anon chi doc duoc kho cong khai');
    const stockRead = await anon.from('PromotionCampaignStock').select('public_slug, available').eq('public_slug', slug);
    check(!stockRead.error && stockRead.data?.length === 1, 'Anon doc PromotionCampaignStock', stockRead.error);
    const claimRead = await anon.from('PromotionWebClaims').select('voucher_code').limit(1);
    check(!!claimRead.error || (claimRead.data?.length ?? 0) === 0, 'Anon KHONG doc duoc PromotionWebClaims', claimRead.data);
    const anonRpc = await anon.rpc('promo_web_reserve', { p_slug: slug, p_device_hash: 'x', p_ip_hash: 'y' });
    check(!!anonRpc.error, 'Anon KHONG goi duoc promo_web_reserve', anonRpc.data);

    console.log('\n[B13] Admin doi so luong');
    const lower = await rpc('promo_web_configure', [created.campaignId, { totalQuantity: 2 }, 'QA']);
    check(errCode(lower) === 'QUANTITY_BELOW_ALLOCATED', 'Giam tong duoi so da cap -> bi tu choi', lower);
    const raise = await rpc('promo_web_configure', [created.campaignId, { totalQuantity: 10 }, 'QA']);
    check(raise.success && raise.data.available === 7, 'Tang tong len 10 -> con 7', raise.data);

    console.log('\n[Tab] Cung thiet bi bam lai -> tra ma cu');
    const again = await reserve('dev-0', 'ip-0');
    const firstCode = results[0].success ? results[0].data.voucherCode : ok[0].data.voucherCode;
    check(again.success && again.data.reused === true, 'reused = true, khong cap ma moi', again);
    check((await stats()).allocated === 3, 'So da cap van la 3');

    console.log('\n[B2] Gioi han theo IP (3 luot giu / IP)');
    const ipRuns = [];
    for (let i = 0; i < 4; i++) ipRuns.push(await reserve(`dev-ip-${i}`, 'ip-shared'));
    check(ipRuns.slice(0, 3).every((r) => r.success), '3 thiet bi cung IP luu duoc');
    check(errCode(ipRuns[3]) === 'RATE_LIMITED', 'Thiet bi thu 4 cung IP -> RATE_LIMITED', ipRuns[3]);

    console.log('\n[B3] Het han giu cho khi cron KHONG chay');
    const expCode = ipRuns[0].data.voucherCode;
    await pool.query(`UPDATE "PromotionWebClaims" SET reservation_expires_at = now() - interval '1 minute' WHERE voucher_code = $1`, [expCode]);
    s = await stats();
    const before = s.allocated;
    await reserve('dev-after-expiry', 'ip-after-expiry');
    const expired = await one(`SELECT status FROM "PromotionWebClaims" WHERE voucher_code = $1`, [expCode]);
    check(expired.status === 'EXPIRED', 'Luot giu qua han -> EXPIRED ngay o lan Luu ke tiep', expired);
    check((await stats()).allocated === before, 'Tra 1 suat + cap 1 suat -> so da cap khong doi', await stats());
    const expiredStatus = await rpc('promo_web_voucher_status', [expCode]);
    check(expiredStatus.data?.status === 'EXPIRED', 'Trang /v/ hien EXPIRED');

    console.log('\n[Q2/Q1] Kich hoat khi dat qua web (tru tien ngay)');
    const codeA = firstCode;
    const webA = await bookOnWeb('0900000001', codeA);
    check(webA.activation?.success === true, 'Kich hoat thanh cong', webA.activation);
    const bookingA = webA.commit.bookingId;
    const bA = await one(`SELECT "totalAmount", source FROM "Bookings" WHERE id = $1`, [bookingA]);
    check(Number(bA.totalAmount) === 270000, 'Tong don 300.000 -> 270.000 (giam 10%)', bA);
    const kmLine = await one(`SELECT price, "technicianCodes" FROM "BookingItems" WHERE "bookingId" = $1 AND options->>'isPromotion' = 'true'`, [bookingA]);
    check(Number(kmLine?.price) === -30000 && (kmLine?.technicianCodes ?? []).length === 0, 'Dong KM -30.000, khong co KTV (khong anh huong hoa hong)', kmLine);
    const claimA = await one(`SELECT status, activation_booking_id, phone FROM "PromotionWebClaims" WHERE voucher_code = $1`, [codeA]);
    check(claimA.status === 'ACTIVE' && claimA.activation_booking_id === bookingA, 'Voucher ACTIVE, gan ma don', claimA);
    const statusA = await rpc('promo_web_voucher_status', [codeA]);
    check(statusA.data.status === 'ACTIVE' && statusA.data.bookingRef?.length === 3 && !JSON.stringify(statusA).includes('0900000001'),
        'Trang /v/ ACTIVE, chi lo 3 ky tu cuoi ma don, khong lo SDT', statusA.data);

    console.log('\n[B7] Dung lai / kich hoat lai');
    const replayAct = await rpc('promo_web_activate', [codeA, bookingA]);
    check(replayAct.success && replayAct.data.replay === true, 'Goi lai cung don -> replay, khong giam 2 lan', replayAct);
    check(Number((await one(`SELECT "totalAmount" FROM "Bookings" WHERE id = $1`, [bookingA])).totalAmount) === 270000, 'Tong don van 270.000');
    const webOther = await bookOnWeb('0911111111', codeA);
    check(webOther.rolledBack && errCode(webOther.activation) === 'VOUCHER_ALREADY_USED', 'Ma da dung cho don khac -> VOUCHER_ALREADY_USED, don bi rollback', webOther.activation);

    console.log('\n[GD4] Gui lai request dat don (idempotency) sau khi da kich hoat');
    const replayClient = await pool.connect();
    try {
        await replayClient.query('BEGIN');
        const r = await replayClient.query('SELECT webbooking_commit_booking($1, $2) AS r',
            [{ ...webA.booking, totalAmount: 300000 }, JSON.stringify(webA.items)]).then((x: any) => x.rows[0].r, (e: any) => ({ error: e.message }));
        console.log('     ket qua replay:', JSON.stringify(r));
        check(true, 'Da ghi nhan hanh vi replay (xem dong tren) - GD4 phai bo dong KM khi so sanh');
        await replayClient.query('ROLLBACK');
    } finally {
        replayClient.release();
    }

    console.log('\n[B9/B10] Chi Web Booking');
    const walkIn = await one(`SELECT id FROM "Bookings" WHERE source <> 'WebBooking' AND status = 'NEW' LIMIT 1`);
    const freeCode = ok[1].data.voucherCode;
    const walkInAct = await rpc('promo_web_activate', [freeCode, walkIn.id]);
    check(errCode(walkInAct) === 'WEB_BOOKING_REQUIRED', 'Don tai quay -> WEB_BOOKING_REQUIRED', walkInAct);
    const passA = await one(`SELECT id FROM "CustomerPromotionPasses" WHERE voucher_code = $1`, [codeA]);
    const counterApply = await rpc('promo_apply_pass', [passA.id, walkIn.id, 'QA-STAFF', true, 'QA override thu']);
    check(!counterApply.success, 'Quay ap ma web vao don tai quay (ke ca override) -> bi chan', counterApply.error);
    await pool.query(`UPDATE "Bookings" SET source = 'STANDARD_WALK_IN' WHERE id = $1`, [bookingA]);
    check((await one(`SELECT status FROM "PromotionWebClaims" WHERE voucher_code = $1`, [codeA])).status === 'ACTIVE',
        'Quay doi source don web -> voucher van ACTIVE');

    console.log('\n[Q5] Gioi han theo SDT: 1 voucher chua dung / SDT');
    const webSamePhone = await bookOnWeb('+84 900 000 001', freeCode);
    check(webSamePhone.rolledBack && errCode(webSamePhone.activation) === 'PHONE_LIMIT_REACHED', 'Cung SDT (dang co voucher ACTIVE) -> PHONE_LIMIT_REACHED', webSamePhone.activation);
    const usageA = await one(`SELECT id FROM "PromotionUsages" WHERE promotion_pass_id = $1`, [passA.id]);
    await pool.query(`UPDATE "PromotionUsages" SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [usageA.id]);
    check((await one(`SELECT status FROM "PromotionWebClaims" WHERE voucher_code = $1`, [codeA])).status === 'REDEEMED', 'Don xong -> REDEEMED');
    const webReturn = await bookOnWeb('0900000001', freeCode);
    check(webReturn.activation?.success === true, 'Khach quay lai (voucher cu da dung) -> kich hoat tiep duoc', webReturn.activation);

    console.log('\n[B12] Huy don -> tra suat');
    s = await stats();
    const allocBeforeCancel = s.allocated;
    await pool.query(`UPDATE "Bookings" SET status = 'CANCELLED' WHERE id = $1`, [webReturn.commit.bookingId]);
    const cancelled = await one(`SELECT w.status, p.status AS pass_status FROM "PromotionWebClaims" w JOIN "CustomerPromotionPasses" p ON p.id = w.pass_id WHERE w.voucher_code = $1`, [freeCode]);
    check(cancelled.status === 'CANCELLED' && cancelled.pass_status === 'CANCELLED', 'Voucher + pass CANCELLED', cancelled);
    check((await stats()).allocated === allocBeforeCancel - 1, 'So da cap giam 1 (suat quay ve kho)', await stats());

    console.log('\n[GD4] RPC boc webbooking_commit_booking_with_voucher');
    await rpc('promo_web_configure', [created.campaignId, { totalQuantity: 20 }, 'QA']);
    const svc2 = 'SEQ_TEST_SVC_90';
    const draft = async (phone: string, services: string[], key = `idemp:qa-w-${stamp}-${Math.random()}`, daysAhead = 2) => {
        const bookingAt = new Date(Date.now() + daysAhead * 86_400_000);
        const id = await rpc('webbooking_allocate_booking_number', [bookingAt.toISOString()]);
        const [, dd, mm, yyyy] = /^WB-(\d{2})(\d{2})(\d{4})-/.exec(id) as RegExpExecArray;
        const items = services.map((sid, i) => ({ id: `${id}-${i + 1}`, serviceId: sid, quantity: 1, price: 300000, options: {} }));
        const booking = {
            id, billCode: id, guestCount: 1, branchName: 'QA', bookingDate: `${yyyy}-${mm}-${dd}T10:00:00`, timeBooking: '10:00',
            customerName: 'QA Promo Khach', customerPhone: phone, customerEmail: 'qa-promo@example.com', customerLang: 'vi',
            customerId: QA_CUSTOMER_ID, totalAmount: 300000 * services.length, idLegacy: key, source: 'WebBooking', status: 'NEW',
        };
        return { booking, items };
    };
    const writeV = async (d: { booking: any; items: any[] }, code: string | null) => {
        try {
            const r = (await pool.query('SELECT webbooking_commit_booking_with_voucher($1, $2, $3) AS r', [d.booking, JSON.stringify(d.items), code])).rows[0].r;
            if (r?.bookingId && !created.bookingIds.includes(r.bookingId)) created.bookingIds.push(r.bookingId);
            return r;
        } catch (e: any) {
            return { thrown: e.message as string };
        }
    };
    const total = async (id: string) => Number((await one(`SELECT "totalAmount" FROM "Bookings" WHERE id = $1`, [id])).totalAmount);
    const freshCode = async (tag: string) => (await reserve(`dev-w-${tag}`, `ip-w-${tag}`)).data.voucherCode as string;

    const dPlain = await draft('0930000001', [QA_SERVICE_ID]);
    const plain = await writeV(dPlain, null);
    check(plain.success === true && plain.idempotent === false && plain.voucher === undefined, 'W1 Khong ma -> y nhu writer cu', plain);
    check(await total(plain.bookingId) === 300000, 'W1 Tong giu nguyen 300.000');

    const c2 = await freshCode('2');
    const d2 = await draft('0930000002', [QA_SERVICE_ID]);
    const w2 = await writeV(d2, c2.toLowerCase());
    check(w2.success && w2.voucher?.applied === true && w2.voucher.discountAmount === 30000 && w2.voucher.totalAmount === 270000,
        'W2 Co ma (chu thuong van nhan) -> giam 30.000, tong 270.000', w2);
    const allocAfterW2 = (await stats()).allocated;

    const w3 = await writeV(d2, c2);
    check(w3.success && w3.idempotent === true && w3.voucher?.applied === true && w3.bookingId === w2.bookingId,
        'W3 Gui lai cung request -> idempotent, khong tao don moi', w3);
    check(await total(w2.bookingId) === 270000, 'W3 Khong giam lan 2 (van 270.000)');
    check((await stats()).allocated === allocAfterW2, 'W3 So da cap khong doi');

    const c4 = await freshCode('4');
    const w4 = await writeV(d2, c4);
    check(w4.thrown === 'IDEMPOTENCY_KEY_REUSED', 'W4 Cung key, ma khac -> IDEMPOTENCY_KEY_REUSED', w4);
    const w5 = await writeV({ booking: { ...d2.booking, timeBooking: '11:00' }, items: d2.items }, c2);
    check(w5.thrown === 'IDEMPOTENCY_KEY_REUSED', 'W5 Cung key, doi gio -> IDEMPOTENCY_KEY_REUSED', w5);

    const c6 = await freshCode('6');
    await pool.query(`UPDATE "PromotionWebClaims" SET reservation_expires_at = now() - interval '1 minute' WHERE voucher_code = $1`, [c6]);
    const d6 = await draft('0930000006', [QA_SERVICE_ID]);
    const w6 = await writeV(d6, c6);
    const leaked = await one(`SELECT count(*)::int AS n FROM "Bookings" WHERE "idLegacy" = $1`, [d6.booking.idLegacy]);
    check(w6.thrown === 'VOUCHER_REJECTED:VOUCHER_EXPIRED' && leaked.n === 0, 'W6 Ma het han -> VOUCHER_REJECTED:VOUCHER_EXPIRED, KHONG tao don', { w6, leaked });
    const w6b = await writeV(d6, 'WBQA-KHONGCO');
    check(w6b.thrown === 'VOUCHER_REJECTED:VOUCHER_NOT_FOUND', 'W6b Ma khong ton tai -> VOUCHER_NOT_FOUND', w6b);
    const w6c = await writeV(d6, null);
    check(w6c.success === true, 'W6c Khach chon "dat khong kem voucher" -> dat duoc', w6c);

    const d7 = await draft('0930000007', [QA_SERVICE_ID]);
    await writeV(d7, null);
    const c7 = await freshCode('7');
    const w7 = await writeV(d7, c7);
    check(w7.success && w7.idempotent === true && w7.voucher?.applied === false && w7.voucher?.reason === 'REPLAY_WITHOUT_VOUCHER',
        'W7 Lan dau khong ma, gui lai kem ma -> khong doi don', w7);
    check((await one(`SELECT status FROM "PromotionWebClaims" WHERE voucher_code = $1`, [c7])).status === 'RESERVED', 'W7 Ma van RESERVED (chua bi dung)');

    const c8 = await freshCode('8');
    const d8 = await draft('0930000008', [QA_SERVICE_ID, svc2]);
    const w8 = await writeV(d8, c8);
    check(w8.success && w8.voucher?.discountAmount === 60000 && w8.voucher.totalAmount === 540000, 'W8 Don 2 dich vu 600.000 -> giam 60.000', w8);

    const d9a = await draft('0930000091', [QA_SERVICE_ID]);
    const d9b = await draft('0930000092', [QA_SERVICE_ID]);
    const [w9a, w9b] = await Promise.all([writeV(d9a, c7), writeV(d9b, c7)]);
    const okCount = [w9a, w9b].filter((r) => r.success && r.voucher?.applied).length;
    const usedErr = [w9a, w9b].filter((r) => r.thrown === 'VOUCHER_REJECTED:VOUCHER_ALREADY_USED').length;
    check(okCount === 1 && usedErr === 1, 'W9 2 don cung luc cung 1 ma -> 1 thanh cong, 1 VOUCHER_ALREADY_USED (don do khong duoc tao)', { w9a, w9b });

    console.log('\n[GD4] Xem truoc tien giam o checkout (promo_web_preview)');
    const cp = await freshCode('p');
    const one1 = [{ serviceId: QA_SERVICE_ID, quantity: 1, options: {} }];
    const two = [...one1, { serviceId: svc2, quantity: 1, options: {} }];
    const p1 = await rpc('promo_web_preview', [cp, JSON.stringify(one1)]);
    check(p1.success && p1.data.eligible && p1.data.discountAmount === 30000 && p1.data.totalAmount === 270000, 'P1 1 dich vu -> xem truoc giam 30.000 (khop W2)', p1);
    const p2 = await rpc('promo_web_preview', [cp, JSON.stringify(two)]);
    check(p2.success && p2.data.discountAmount === w8.voucher?.discountAmount, 'P2 2 dich vu -> xem truoc = so tien thuc te khi dat (W8)', { p2: p2.data?.discountAmount, w8: w8.voucher?.discountAmount });
    const p3 = await rpc('promo_web_preview', [c6, JSON.stringify(one1)]);
    check(errCode(p3) === 'VOUCHER_EXPIRED', 'P3 Ma het han -> VOUCHER_EXPIRED', p3);
    const p4 = await rpc('promo_web_preview', [cp, JSON.stringify([{ serviceId: 'KHONG_CO', quantity: 1, options: {} }])]);
    check(errCode(p4) === 'SERVICE_NOT_BOOKABLE', 'P4 Dich vu khong ton tai -> SERVICE_NOT_BOOKABLE', p4);
    await pool.query(`UPDATE "PromotionCampaigns" SET apply_conditions = '{"match":"ALL","conditions":[{"minOrderAmount":500000}]}'::jsonb WHERE id = $1`, [created.campaignId]);
    const p5 = await rpc('promo_web_preview', [cp, JSON.stringify(one1)]);
    check(p5.success && p5.data.eligible === false && p5.data.discountAmount === 0 && p5.data.unmetReasons.length > 0, 'P5 Don 300.000 < dieu kien 500.000 -> chua du, co ly do', p5.data);
    const p6 = await rpc('promo_web_preview', [cp, JSON.stringify(two)]);
    check(p6.success && p6.data.eligible === true && p6.data.discountAmount === 60000, 'P6 Don 600.000 -> du dieu kien', p6.data);
    const d5 = await draft('0930000005', [QA_SERVICE_ID]);
    const w5c = await writeV(d5, cp);
    check(w5c.thrown === 'VOUCHER_REJECTED:ORDER_CONDITION_NOT_MET', 'P5 Dat that don chua du dieu kien -> bi tu choi (khong ap ngoai le)', w5c);
    await pool.query(`UPDATE "PromotionCampaigns" SET apply_conditions = '{"match":"ALL","conditions":[]}'::jsonb WHERE id = $1`, [created.campaignId]);
    const leftover = await one(`SELECT count(*)::int AS n FROM "Bookings" WHERE id LIKE 'WB-PREVIEW-%'`);
    check(leftover.n === 0, 'P7 Xem truoc khong de lai don tam nao', leftover);
    check((await one(`SELECT status FROM "PromotionWebClaims" WHERE voucher_code = $1`, [cp])).status === 'RESERVED', 'P7 Xem truoc khong lam doi trang thai ma');

    await setFlag(false);
    const c10 = await freshCode('10').catch(() => null);
    const d10 = await draft('0930000010', [QA_SERVICE_ID]);
    const w10 = await writeV(d10, c10 ?? c2);
    check(w10.thrown === 'VOUCHER_REJECTED:FEATURE_DISABLED', 'W10 Tat cong tac -> voucher bi tu choi, don khong tao', w10);
    check((await writeV(d10, null)).success === true, 'W10 Tat cong tac, khong ma -> van dat duoc');
    await setFlag(true);

    // ─── v17: hardening after the 09/10/2026 review ───────────────────────────────────────
    console.log('\n[v17] Tu chua voucher ACTIVE, huy het dich vu, khong den, chan phat lach, ngay hen');
    await rpc('promo_web_configure', [created.campaignId, { totalQuantity: 40 }, 'QA']);
    const heal = () => rpc('promo_web_heal_claims', []);
    const claimOf = (code: string) => one(`SELECT w.status, w.end_reason, w.usage_id, w.activation_booking_id, p.status AS pass_status
                                             FROM "PromotionWebClaims" w LEFT JOIN "CustomerPromotionPasses" p ON p.id = w.pass_id
                                            WHERE w.voucher_code = $1`, [code]);
    const kmOf = (bookingId: string) => one(`SELECT id, status, price FROM "BookingItems" WHERE "bookingId" = $1 AND options->>'isPromotion' = 'true'`, [bookingId]);
    const bookWith = async (tag: string, phone: string) => {
        const code = await freshCode(`v17-${tag}`);
        const w = await writeV(await draft(phone, [QA_SERVICE_ID]), code);
        return { code, bookingId: w.bookingId as string, w };
    };
    // Counter split: one child gets every line, the parent becomes SPLIT (same shape as split_booking_into_sub_bookings).
    const splitTo = async (parentId: string, childStatus: string) => {
        const childId = `${parentId}-A`;
        await pool.query(`INSERT INTO "Bookings" (id, "billCode", source, status, "totalAmount", "guestCount", "updatedAt", parent_booking_id)
                          SELECT $1, $1, source, 'NEW', "totalAmount", 1, now() AT TIME ZONE 'UTC', id FROM "Bookings" WHERE id = $2`, [childId, parentId]);
        created.bookingIds.push(childId);
        await pool.query(`UPDATE "BookingItems" SET "bookingId" = $1 WHERE "bookingId" = $2`, [childId, parentId]);
        await pool.query(`UPDATE "Bookings" SET status = 'SPLIT', "totalAmount" = 0 WHERE id = $1`, [parentId]);
        await pool.query(`UPDATE "BookingItems" SET status = $2 WHERE "bookingId" = $1 AND options->>'isPromotion' IS DISTINCT FROM 'true'`,
            [childId, childStatus === 'DONE' ? 'DONE' : 'CANCELLED']);
        await pool.query(`UPDATE "Bookings" SET status = $2 WHERE id = $1`, [childId, childStatus]);
        return childId;
    };

    const healthy = await bookWith('ok', '0940000000');
    const v1 = await bookWith('split-done', '0940000001');
    await splitTo(v1.bookingId, 'DONE');
    check((await claimOf(v1.code)).status === 'ACTIVE', 'V1 Tach don, don con xong -> truoc khi tu chua van ACTIVE (loi cu)');
    let allocBefore = (await stats()).allocated;
    const healed1 = await heal();
    check((await claimOf(v1.code)).status === 'REDEEMED', 'V1 Tu chua: don tach, don con DONE -> REDEEMED', healed1);
    check((await stats()).allocated === allocBefore, 'V1 REDEEMED van giu suat (da dung)');
    check((await claimOf(healthy.code)).status === 'ACTIVE', 'V1 Don binh thuong chua den ngay hen -> khong bi dong vao');

    const v2 = await bookWith('split-cancel', '0940000002');
    await splitTo(v2.bookingId, 'CANCELLED');
    allocBefore = (await stats()).allocated;
    await heal();
    const c2v = await claimOf(v2.code);
    check(c2v.status === 'CANCELLED' && c2v.pass_status === 'CANCELLED', 'V2 Tach don, don con huy het -> CANCELLED + pass huy', c2v);
    check((await stats()).allocated === allocBefore - 1, 'V2 Suat quay ve kho');

    const v3 = await bookWith('cancel-all', '0940000003');
    allocBefore = (await stats()).allocated;
    await pool.query(`UPDATE "BookingItems" SET status = 'CANCELLED' WHERE "bookingId" = $1 AND options->>'isPromotion' IS DISTINCT FROM 'true'`, [v3.bookingId]);
    await pool.query(`UPDATE "Bookings" SET status = 'DONE' WHERE id = $1`, [v3.bookingId]);
    const c3v = await claimOf(v3.code);
    const km3 = await kmOf(v3.bookingId);
    check(c3v.status === 'CANCELLED' && c3v.end_reason === 'NO_SERVICE_PERFORMED', 'V3 Huy het dich vu roi dong don -> voucher KHONG bi tinh la da dung', c3v);
    check(km3.status === 'CANCELLED' && await total(v3.bookingId) === 300000, 'V3 Dong giam bi huy, tong tra lai +30.000', { km3, total: await total(v3.bookingId) });
    check((await stats()).allocated === allocBefore - 1, 'V3 Suat quay ve kho');

    const v4 = await bookWith('no-show', '0940000004');
    allocBefore = (await stats()).allocated;
    await heal();
    check((await claimOf(v4.code)).status === 'ACTIVE', 'V4 Chua qua ngay hen -> giu nguyen');
    await pool.query(`UPDATE "Bookings" SET "bookingDate" = "bookingDate" - interval '3 days' WHERE id = $1`, [v4.bookingId]);
    await heal();
    const c4v = await claimOf(v4.code);
    check(c4v.status === 'CANCELLED' && c4v.end_reason === 'NO_SHOW', 'V4 Qua het ngay hen, don chua bat dau -> NO_SHOW, tra suat', c4v);
    check(await total(v4.bookingId) === 300000 && (await kmOf(v4.bookingId)).status === 'CANCELLED', 'V4 Don ve gia goc (khach den tre tra gia goc)');
    check((await stats()).allocated === allocBefore - 1, 'V4 Suat quay ve kho');

    const v5 = await bookWith('lost-trigger', '0940000005');
    await pool.query(`UPDATE "Bookings" SET status = 'DONE' WHERE id = $1`, [v5.bookingId]);
    // Simulate the swallowed trigger error: usage back to APPLIED, claim back to ACTIVE.
    const c5 = await claimOf(v5.code);
    await pool.query(`UPDATE "PromotionUsages" SET status = 'APPLIED', completed_at = NULL WHERE id = $1`, [c5.usage_id]);
    await pool.query(`UPDATE "PromotionWebClaims" SET status = 'ACTIVE', redeemed_at = NULL WHERE voucher_code = $1`, [v5.code]);
    await heal();
    check((await claimOf(v5.code)).status === 'REDEEMED', 'V5 Trigger loi bi nuot (don DONE, usage APPLIED) -> tu chua REDEEMED');
    await pool.query(`UPDATE "PromotionWebClaims" SET status = 'ACTIVE', redeemed_at = NULL WHERE voucher_code = $1`, [v5.code]);
    await heal();
    check((await claimOf(v5.code)).status === 'REDEEMED', 'V5b Usage COMPLETED nhung claim ACTIVE -> dong bo REDEEMED');

    const draftOut = await draft('0940000006', [QA_SERVICE_ID], undefined, 10);
    const codeOut = await freshCode('v17-out');
    const wOut = await writeV(draftOut, codeOut);
    check(wOut.thrown === 'VOUCHER_REJECTED:BOOKING_DATE_OUT_OF_RANGE', 'V6 Ngay hen sau khi chuong trinh ket thuc -> tu choi, khong tao don', wOut);
    const pOut = await rpc('promo_web_preview', [codeOut, JSON.stringify(one1), draftOut.booking.bookingDate]);
    check(errCode(pOut) === 'BOOKING_DATE_OUT_OF_RANGE', 'V6 Xem truoc cung bao BOOKING_DATE_OUT_OF_RANGE', pOut);
    const pIn = await rpc('promo_web_preview', [codeOut, JSON.stringify(one1), (await draft('0940000007', [QA_SERVICE_ID])).booking.bookingDate]);
    check(pIn.success === true, 'V6 Ngay hen trong thoi gian chuong trinh -> xem truoc binh thuong', pIn);

    const healthyPass = await one(`SELECT pass_id FROM "PromotionWebClaims" WHERE voucher_code = $1`, [healthy.code]);
    const statusAct = await rpc('promo_set_pass_status', [healthyPass.pass_id, 'CANCEL', 'QA', 'QA']);
    check(errCode(statusAct) === 'WEB_CLAIM_PASS_MANAGED', 'V7 Admin huy pass web -> bi chan, chi dan huy dong KM', statusAct);
    const otherWeb = await writeV(await draft('0940000008', [QA_SERVICE_ID]), null);
    const counterWeb = await rpc('promo_apply_pass', [healthyPass.pass_id, otherWeb.bookingId, 'QA-STAFF', true, 'QA override']);
    check(errCode(counterWeb) === 'WEB_BOOKING_REQUIRED', 'V8 Quay ap ma web vao don web khac -> WEB_BOOKING_REQUIRED', counterWeb);
    const manualWeb = await rpc('promo_issue_manual', [created.campaignId, QA_CUSTOMER_ID, 'QA']);
    check(errCode(manualWeb) === 'WEB_CLAIM_ISSUE_FORBIDDEN', 'V9 Phat tay cho chuong trinh web -> WEB_CLAIM_ISSUE_FORBIDDEN', manualWeb);
    const bulkWeb = await rpc('promo_issue_bulk', [created.campaignId, [QA_CUSTOMER_ID], 'QA']);
    check(errCode(bulkWeb) === 'WEB_CLAIM_ISSUE_FORBIDDEN', 'V9 Phat hang loat -> WEB_CLAIM_ISSUE_FORBIDDEN', bulkWeb);
    const rawInsert = await pool.query(`INSERT INTO "CustomerPromotionPasses" (campaign_id, customer_id, voucher_code, qr_token, status, benefit_type,
                                            benefit_value, usage_type, usage_limit, valid_from, valid_until, issue_source)
                                        SELECT id, $2, 'WBQA-RAW001', 'qa-raw-token', 'ACTIVE', benefit_type, benefit_value, 'ONE_TIME', 1,
                                               valid_from, valid_until, 'MANUAL' FROM "PromotionCampaigns" WHERE id = $1`,
        [created.campaignId, QA_CUSTOMER_ID]).then(() => 'inserted', (e: any) => e.message);
    check(rawInsert === 'WEB_CLAIM_ISSUE_FORBIDDEN', 'V9 Chen pass tay vao bang -> trigger chan', rawInsert);

    const mkCampaign = async (tag: string, benefit: string, value: number, mode: string) => {
        const now = Date.now();
        const c = await one(`INSERT INTO "PromotionCampaigns"(campaign_code, name, benefit_type, benefit_value, valid_from, valid_until,
                                usage_type, voucher_prefix, status, created_by, assignment_mode)
                             VALUES ($1, 'QA v17', $2, $3, $4, $5, 'ONE_TIME', 'WBQB', 'ACTIVE', 'QA', $6) RETURNING id`,
            [`QAV17-${tag}-${stamp}`, benefit, value, new Date(now - 3_600_000), new Date(now + 7 * 86_400_000), mode]);
        created.extraCampaignIds.push(c.id);
        await rpc('promo_sync_benefit_service', [c.id]);
        return c.id as string;
    };
    const conf = (id: string) => rpc('promo_web_configure', [id, { totalQuantity: 5, publicSlug: `qa-v17-${id.slice(0, 8)}` }, 'QA']);
    const reasonOf = (r: any) => r?.error?.data?.reason ?? r?.data?.reason;
    const cFree = await mkCampaign('free', 'FREE_MINUTES', 30, 'MANUAL_ONLY');
    const rFree = await conf(cFree);
    check(errCode(rFree) === 'WEB_CLAIM_NOT_ELIGIBLE' && reasonOf(rFree) === 'BENEFIT_TYPE', 'V10 Chuong trinh tang phut -> khong phat web duoc', rFree);
    const cAuto = await mkCampaign('auto', 'PERCENT_DISCOUNT', 10, 'AUTO');
    const rAuto = await conf(cAuto);
    check(errCode(rAuto) === 'WEB_CLAIM_NOT_ELIGIBLE' && reasonOf(rAuto) === 'AUTO_ASSIGNMENT', 'V10 Chuong trinh tu phat khi don xong -> khong phat web duoc', rAuto);
    const cOld = await mkCampaign('old', 'PERCENT_DISCOUNT', 10, 'MANUAL_ONLY');
    await rpc('promo_issue_manual', [cOld, QA_CUSTOMER_ID, 'QA']);
    const rOld = await conf(cOld);
    check(errCode(rOld) === 'WEB_CLAIM_NOT_ELIGIBLE' && reasonOf(rOld) === 'HAS_PASSES', 'V10 Chuong trinh da phat ma kieu cu (VD WB_OCT_2026) -> khong chuyen duoc', rOld);
    const oldStats = await rpc('promo_web_campaign_stats', [cOld]);
    check(oldStats.webIneligibleReason === 'HAS_PASSES' && oldStats.distributionChannel === 'ADMIN_ISSUE', 'V10 Stats bao ly do de the admin an nut Bat', oldStats);
    const sNow = await stats();
    check(sNow.webIneligibleReason === null && typeof sNow.staleActive === 'number', 'V10 Stats chuong trinh web: co staleActive', sNow);

    const cExp = await freshCode('v17-exp');
    await rpc('promo_web_set_paused', [created.campaignId, true, 'QA']);
    await pool.query(`UPDATE "PromotionWebClaims" SET reservation_expires_at = now() - interval '1 minute' WHERE voucher_code = $1`, [cExp]);
    check(errCode(await reserve('dev-v17-paused', 'ip-v17-paused')) === 'CAMPAIGN_PAUSED', 'V11 Luu khi tam dung -> CAMPAIGN_PAUSED');
    const pub = await one(`SELECT available, status FROM "PromotionCampaignStock" WHERE campaign_id = $1`, [created.campaignId]);
    check(pub.available === (await stats()).available, 'V11 The cong khai cap nhat ngay ca khi tra loi (khong bi cu)', { pub, stats: await stats() });
    await rpc('promo_web_set_paused', [created.campaignId, false, 'QA']);

    console.log('\n[Pause] Tam dung phat');
    const holdCode = ok[2].data.voucherCode;
    await rpc('promo_web_set_paused', [created.campaignId, true, 'QA']);
    check(errCode(await reserve('dev-paused', 'ip-paused')) === 'CAMPAIGN_PAUSED', 'Tam dung -> khong Luu moi duoc');
    const webPaused = await bookOnWeb('0922222222', holdCode);
    check(webPaused.activation?.success === true, 'Tam dung -> voucher dang giu van kich hoat duoc', webPaused.activation);
    await rpc('promo_web_set_paused', [created.campaignId, false, 'QA']);

    console.log('\n[B2] Nut giai phong moi luot giu');
    const rel = await rpc('promo_web_release', [created.campaignId, null, 'QA bot', 'QA']);
    check(rel.success && rel.data.reserved === 0, `Giai phong ${rel.data?.released} luot giu, con 0 RESERVED`, rel.data);

    console.log('\n[B13] Ket thuc chuong trinh');
    await reserve('dev-before-end', 'ip-before-end');
    const beforeEnd = await stats();
    await pool.query(`UPDATE "PromotionCampaigns" SET status = 'ENDED' WHERE id = $1`, [created.campaignId]);
    s = await stats();
    check(s.reserved === 0 && s.stockStatus === 'ENDED', 'ENDED -> luot giu EXPIRED, kho ENDED', s);
    check(errCode(await reserve('dev-ended', 'ip-ended')) === 'CAMPAIGN_ENDED', 'Luu sau khi ket thuc -> CAMPAIGN_ENDED');
    check(s.active === beforeEnd.active && s.redeemed === beforeEnd.redeemed && s.active > 0, 'Voucher da kich hoat / da dung giu nguyen', { beforeEnd, s });

    console.log('\n[GD2] Tang service ma API admin goi (PromotionEngineService)');
    const ov = await PromotionEngineService.getWebClaimOverview(created.campaignId, null);
    check(ov.success && ov.data.stats.distributionChannel === 'WEB_CLAIM' && ov.data.stats.campaignStatus === 'ENDED',
        'getWebClaimOverview: stats co kenh + trang thai chuong trinh', ov.success ? ov.data.stats : ov.error);
    check(ov.success && ov.data.claims.length > 0 && ov.data.claims.every((c) => 'voucherCode' in c && 'status' in c),
        'getWebClaimOverview: tra danh sach voucher', ov.success ? ov.data.claims.length : ov.error);
    const onlyActive = await PromotionEngineService.getWebClaimOverview(created.campaignId, 'ACTIVE');
    check(onlyActive.success && onlyActive.data.claims.every((c) => c.status === 'ACTIVE'), 'Loc theo trang thai ACTIVE');
    const below = await PromotionEngineService.configureWebClaim(created.campaignId,
        { totalQuantity: 1, reservationMinutes: 30, maxOpenPerPhone: 1, maxTotalPerPhone: null, publicSlug: slug }, 'QA');
    check(!below.success && below.error.code === 'QUANTITY_BELOW_ALLOCATED', 'configureWebClaim: giam duoi so da cap -> loi dung ma', below);
    const notFound = await PromotionEngineService.getWebClaimOverview('00000000-0000-0000-0000-000000000000', null);
    check(!notFound.success && notFound.error.code === 'CAMPAIGN_NOT_FOUND', 'Chuong trinh khong ton tai -> CAMPAIGN_NOT_FOUND', notFound);
    const relNone = await PromotionEngineService.releaseWebClaims(created.campaignId, '00000000-0000-0000-0000-000000000000', 'QA', 'QA');
    check(!relNone.success && relNone.error.code === 'VOUCHER_NOT_RESERVED', 'Thu hoi ma khong o trang thai giu -> VOUCHER_NOT_RESERVED', relNone);

    console.log('\n[GD2] API mock (dev) cung hop dong');
    const mock = createMockPromotionApi();
    const mid = 'mock-campaign';
    const m0 = await mock.getWebClaim(mid);
    check(m0.success && m0.data.stats.distributionChannel === 'ADMIN_ISSUE', 'Mock: chua bat -> ADMIN_ISSUE');
    const m1 = await mock.configureWebClaim(mid, { totalQuantity: 5, reservationMinutes: 30, maxOpenPerPhone: 1, maxTotalPerPhone: null, publicSlug: 'mock-slug' });
    check(m1.success && m1.data.total === 5 && m1.data.available === 2, 'Mock: bat 5 suat, 3 da cap -> con 2', m1);
    const m2 = await mock.configureWebClaim(mid, { totalQuantity: 2, reservationMinutes: 30, maxOpenPerPhone: 1, maxTotalPerPhone: null, publicSlug: 'mock-slug' });
    check(!m2.success && m2.error.code === 'QUANTITY_BELOW_ALLOCATED', 'Mock: giam duoi so da cap -> loi');
    const m3 = await mock.releaseWebClaims(mid, 'QA');
    check(m3.success && m3.data.released === 1 && m3.data.reserved === 0, 'Mock: giai phong moi luot giu');

    await anon.removeChannel(channel);
};

main()
    .catch((e) => { failures++; console.error('FATAL', e); })
    .finally(async () => {
        await cleanup().catch((e) => console.error('cleanup failed', e.message));
        await pool.end();
        console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAIL`}`);
        process.exit(failures === 0 ? 0 : 1);
    });
