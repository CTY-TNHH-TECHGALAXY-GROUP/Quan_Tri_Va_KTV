/**
 * Seed data for the HAND test of web e-vouchers on Vercel Hobby + Supabase TEST.
 * Guide: plans/huong_dan_test_tay_evoucher_hobby.md
 *
 *   set -a; source <TEST .env.local>; set +a
 *   node scripts/qa/seed_evoucher_hobby_test.mjs            # create
 *   node scripts/qa/seed_evoucher_hobby_test.mjs --cleanup  # remove everything it created
 *
 * Creates one campaign "QA Hobby" (8 slots, -10%) and 5 web bookings that already carry an
 * ACTIVE voucher, one per counter scenario. The global switch `promotion_web_claim_enabled`
 * is turned on ONLY inside each seed transaction and restored before COMMIT, so parallel
 * sessions on TEST never see it change. Refuses to run on anything but TEST.
 */
import fs from 'fs';
import pg from 'pg';

// 🔧 CONFIGURATION
const TEST_PROJECT_REF = 'eknggruuiuadwldacpmb';
const CAMPAIGN_PREFIX = 'QAHOBBY-';
const CUSTOMER_PREFIX = 'CUS-QAHOBBY-';
const VIP_SERVICE = { id: 'NHPQA01', code: 'NHPQA01', name: 'QA Hobby VIP 60 phút', price: 500000, duration: 60 };
const BODY_60 = 'SEQ_TEST_SVC_60';
const BODY_90 = 'SEQ_TEST_SVC_90';
const TOTAL_SLOTS = 8;
const FLAG = 'promotion_web_claim_enabled';

if (!process.env.DIRECT_URL?.includes(TEST_PROJECT_REF) || !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(TEST_PROJECT_REF)) {
    throw new Error('Refusing to run: env does not point at Supabase TEST');
}
const pool = new pg.Pool({
    connectionString: process.env.DIRECT_URL,
    ssl: process.env.DYNAMIC_DB_CA_CERT_PATH
        ? { ca: fs.readFileSync(process.env.DYNAMIC_DB_CA_CERT_PATH, 'utf8') }
        : { rejectUnauthorized: false },
});
const one = async (sql, params = [], client = pool) => (await client.query(sql, params)).rows[0];

// VN calendar helpers (bookingDate is VN wall clock without a zone).
const vnDate = (offsetDays) => {
    const d = new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000);
    return d.toISOString().slice(0, 10);
};
const vnHourNow = () => new Date(Date.now() + 7 * 3_600_000).getUTCHours();

const SCENARIOS = [
    { key: 'S1-VIP', label: 'Quầy xác nhận đơn VIP có voucher', services: [VIP_SERVICE.id], guests: 1, day: 1, time: '10:00' },
    { key: 'S2-TACH', label: 'Quầy tách đơn 2 khách', services: [BODY_60, BODY_90], guests: 2, day: 1, time: '11:00' },
    { key: 'S3-HUYHET', label: 'Quầy huỷ hết dịch vụ rồi đóng đơn', services: [BODY_60, BODY_90], guests: 1, day: 1, time: '13:00' },
    { key: 'S4-KHONGDEN', label: 'Khách không đến (hẹn hôm qua)', services: [BODY_60], guests: 1, day: -1, time: '15:00' },
    { key: 'S5-TRONVEN', label: 'Làm trọn vẹn tới DONE', services: [BODY_60], guests: 1, day: 0,
      time: `${String(Math.min(22, vnHourNow() + 1)).padStart(2, '0')}:00` },
];

/** Run fn with the switch on, visible only inside this transaction. */
const withSwitchInTx = async (client, fn) => {
    const prev = await one(`SELECT value FROM "SystemConfigs" WHERE key = $1 FOR UPDATE`, [FLAG], client);
    await client.query(`INSERT INTO "SystemConfigs"(key, value) VALUES ($1, 'true'::jsonb)
                        ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`, [FLAG]);
    try {
        return await fn();
    } finally {
        if (prev) await client.query(`UPDATE "SystemConfigs" SET value = $2 WHERE key = $1`, [FLAG, prev.value]);
        else await client.query(`DELETE FROM "SystemConfigs" WHERE key = $1`, [FLAG]);
    }
};

const seed = async () => {
    const stamp = Date.now().toString(36).toUpperCase();
    const slug = `qa-hobby-${stamp.toLowerCase()}`;

    await pool.query(`INSERT INTO "Services" (id, code, "nameVN", "nameEN", "priceVND", "priceUSD", duration, category, "isActive", service_group, min_ktv_required)
                      VALUES ($1, $2, $3, $3, $4, 0, $5, 'VIP_MENU', true, 'MAIN', 1) ON CONFLICT (id) DO NOTHING`,
        [VIP_SERVICE.id, VIP_SERVICE.code, VIP_SERVICE.name, VIP_SERVICE.price, VIP_SERVICE.duration]);

    const now = Date.now();
    const c = await one(`INSERT INTO "PromotionCampaigns"(campaign_code, name, benefit_type, benefit_value, valid_from, valid_until,
                            usage_type, voucher_prefix, status, created_by, assignment_mode)
                         VALUES ($1, 'QA Hobby Oria Booking Rewards', 'PERCENT_DISCOUNT', 10, $2, $3, 'ONE_TIME', 'HOBBY', 'ACTIVE', 'QA', 'MANUAL_ONLY')
                         RETURNING id`,
        [`${CAMPAIGN_PREFIX}${stamp}`, new Date(now - 2 * 86_400_000), new Date(now + 7 * 86_400_000)]);
    await one(`SELECT promo_sync_benefit_service($1)`, [c.id]);
    const conf = (await one(`SELECT promo_web_configure($1, $2, 'QA') AS r`, [c.id, { totalQuantity: TOTAL_SLOTS, reservationMinutes: 30, publicSlug: slug }])).r;
    if (!conf.success) throw new Error(`configure failed: ${JSON.stringify(conf)}`);

    const prices = Object.fromEntries((await pool.query(`SELECT id, "priceVND" FROM "Services" WHERE id = ANY($1)`,
        [[VIP_SERVICE.id, BODY_60, BODY_90]])).rows.map((r) => [r.id, Number(r.priceVND)]));

    const out = [];
    for (const [i, s] of SCENARIOS.entries()) {
        const phone = `0999${String(now).slice(-5)}${i}`; // 10 digits, unique per run
        const customerId = `${CUSTOMER_PREFIX}${stamp}-${i + 1}`;
        await pool.query(`INSERT INTO "Customers"(id, "fullName", phone, email, "createdAt", "updatedAt")
                          VALUES ($1, $2, $3, $4, now(), now())`,
            [customerId, `QA Hobby ${s.key}`, phone, `qa-hobby-${stamp.toLowerCase()}-${i + 1}@example.com`]);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await withSwitchInTx(client, async () => {
                const res = (await one(`SELECT promo_web_reserve($1, $2, $3) AS r`, [slug, `seed-${stamp}-${i}`, `seed-ip-${stamp}-${i}`], client)).r;
                if (!res.success) throw new Error(`${s.key} reserve: ${JSON.stringify(res)}`);
                const code = res.data.voucherCode;
                const ymd = vnDate(s.day);
                const id = (await one(`SELECT webbooking_allocate_booking_number($1) AS r`, [`${ymd}T${s.time}:00+07:00`], client)).r;
                const items = s.services.map((sid, n) => ({
                    id: `${id}-${sid}-${n}-unit1`, serviceId: sid, quantity: 1, price: prices[sid], options: {},
                }));
                const total = items.reduce((a, it) => a + it.price, 0);
                const booking = {
                    id, billCode: id, guestCount: s.guests, branchName: 'Oria Spa', bookingDate: `${ymd}T${s.time}:00`, timeBooking: s.time,
                    customerName: `QA Hobby ${s.key}`, customerPhone: phone, customerEmail: `qa-hobby-${stamp.toLowerCase()}-${i + 1}@example.com`,
                    customerLang: 'vi', customerId, totalAmount: total, idLegacy: `idemp:qa-hobby-${stamp}-${i}`, source: 'WebBooking', status: 'NEW',
                    notes: s.guests > 1 ? `Guests: ${s.guests}` : null,
                };
                const w = (await one(`SELECT webbooking_commit_booking_with_voucher($1, $2, $3) AS r`, [booking, JSON.stringify(items), code], client)).r;
                return { code, bookingId: w.bookingId, subtotal: total, voucher: w.voucher };
            });
            await client.query('COMMIT');
            out.push({ ...s, ...result });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    const stats = (await one(`SELECT promo_web_campaign_stats($1) AS r`, [c.id])).r;
    console.log(`\nChương trình: QA Hobby Oria Booking Rewards (${CAMPAIGN_PREFIX}${stamp}), đường dẫn ${slug}`);
    console.log(`Suất: tổng ${stats.total}, đã kích hoạt ${stats.active}, còn ${stats.available}\n`);
    console.table(out.map((o) => ({
        'Kịch bản': o.key, 'Việc ở quầy': o.label, 'Mã đơn': o.bookingId, 'Voucher': o.code,
        'Ngày hẹn': `${vnDate(o.day)} ${o.time}`, 'Tạm tính': o.subtotal, 'Giảm': o.voucher?.discountAmount, 'Tổng': o.voucher?.totalAmount,
    })));
};

const cleanup = async () => {
    const camps = (await pool.query(`SELECT id, benefit_service_id FROM "PromotionCampaigns" WHERE campaign_code LIKE $1`, [`${CAMPAIGN_PREFIX}%`])).rows;
    const ids = camps.map((c) => c.id);
    const parents = (await pool.query(`SELECT DISTINCT activation_booking_id AS id FROM "PromotionWebClaims"
                                       WHERE campaign_id = ANY($1) AND activation_booking_id IS NOT NULL`, [ids])).rows.map((r) => r.id);
    const byCustomer = (await pool.query(`SELECT id FROM "Bookings" WHERE "customerId" LIKE $1`, [`${CUSTOMER_PREFIX}%`])).rows.map((r) => r.id);
    const roots = [...new Set([...parents, ...byCustomer])];
    const children = (await pool.query(`SELECT id FROM "Bookings" WHERE parent_booking_id = ANY($1)`, [roots])).rows.map((r) => r.id);
    const bookings = [...children, ...roots];
    const steps = [
        [`DELETE FROM "PromotionWebClaims" WHERE campaign_id = ANY($1)`, [ids]],
        [`DELETE FROM "PromotionUsages" WHERE campaign_id = ANY($1)`, [ids]],
        [`DELETE FROM "CustomerPromotionPasses" WHERE campaign_id = ANY($1)`, [ids]],
        [`DELETE FROM "BookingItems" WHERE "bookingId" = ANY($1)`, [bookings]],
        [`DELETE FROM "BookingGuests" WHERE booking_id = ANY($1)`, [bookings]],
        [`DELETE FROM "Bookings" WHERE id = ANY($1)`, [children]],
        [`DELETE FROM "Bookings" WHERE id = ANY($1)`, [roots]],
        [`DELETE FROM "PromotionCampaignStock" WHERE campaign_id = ANY($1)`, [ids]],
        [`DELETE FROM "PromotionCampaigns" WHERE id = ANY($1)`, [ids]],
        [`DELETE FROM "Services" WHERE id = ANY($1)`, [camps.map((c) => c.benefit_service_id).filter(Boolean)]],
        [`DELETE FROM "Services" WHERE id = $1`, [VIP_SERVICE.id]],
        [`DELETE FROM "Customers" WHERE id LIKE $1`, [`${CUSTOMER_PREFIX}%`]],
    ];
    for (const [sql, params] of steps) {
        try {
            const r = await pool.query(sql, params);
            console.log(`  ✅ ${sql.slice(0, 60)}… (${r.rowCount})`);
        } catch (e) {
            // Dispatch on Hobby may have attached KTV rows (TurnQueue, ledgers…): leave those orders cancelled.
            console.log(`  ⚠️ ${sql.slice(0, 60)}… bỏ qua: ${e.message}`);
            if (sql.includes('"Bookings"')) {
                await pool.query(`UPDATE "Bookings" SET status = 'CANCELLED' WHERE id = ANY($1) AND status::text <> 'CANCELLED'`, [params[0]]).catch(() => undefined);
            }
        }
    }
    console.log(`Đã dọn ${ids.length} chương trình, ${bookings.length} đơn.`);
};

(process.argv.includes('--cleanup') ? cleanup() : seed())
    .catch((e) => { console.error('❌', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
