/**
 * ================================================================
 * TEST: auto_complete_unrated_feedback() on the real DB — ROLLED BACK
 * ================================================================
 * Everything runs inside ONE transaction that always ends in ROLLBACK:
 * the function is created, fixtures inserted, the job run, results checked,
 * then all of it disappears. Triggers are disabled for the transaction
 * (session_replication_role = replica) so no push/notification side effects.
 *
 * Also a dry run on real rows: prints how many real FEEDBACK items the job
 * would close, and asserts no real non-FEEDBACK item changes status.
 *
 * Run (from repo root):
 *   node scripts/qa/qa_auto_complete_feedback.cjs
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
const get = k => (env.split('\n').find(l => l.startsWith(k + '=')) || '').slice(k.length + 1).trim().replace(/^"|"$/g, '');

const MIGRATION = path.resolve('supabase/migrations/20260914120000_auto_complete_feedback_after_5m.sql');
const FUNCTION_SQL = fs.readFileSync(MIGRATION, 'utf-8').split('-- @@CRON_SECTION@@')[0];

const PREFIX = 'QA-AUTOFB-';
const minsAgo = m => new Date(Date.now() - m * 60000).toISOString();
const seg = (fbMinsAgo, extra = {}) => ({
    id: 'seg1', ktvId: 'T011', actualStartTime: minsAgo(80), actualEndTime: minsAgo(20),
    handoverTime: minsAgo(15), ...(fbMinsAgo != null ? { feedbackTime: minsAgo(fbMinsAgo) } : {}), ...extra,
});

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name} ${detail}`); }
};

(async () => {
    const c = new Client({ connectionString: get('DIRECT_URL') || get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
    await c.connect();
    try {
        await c.query('BEGIN');
        await c.query("SET LOCAL lock_timeout = '3s'");
        await c.query("SET LOCAL statement_timeout = '60s'");
        await c.query('SET LOCAL session_replication_role = replica');

        await c.query(FUNCTION_SQL);

        // ── Real-row snapshot (dry run) ─────────────────────────────
        const realFeedback = await c.query(`
            SELECT i.id, (i."itemRating" IS NULL AND g.rating IS NULL) AS no_rating,
                   COALESCE(booking_item_last_feedback_time(i.segments), i.handover_submitted_at, i."timeEnd",
                            b."updatedAt" AT TIME ZONE 'UTC') AS entered_at
              FROM "BookingItems" i JOIN "Bookings" b ON b.id = i."bookingId"
              LEFT JOIN "BookingGuests" g ON g.id = i.guest_id
             WHERE i.status = 'FEEDBACK'`);
        const CUTOFF = new Date('2026-09-01T00:00:00+07:00');
        const afterCutoff = realFeedback.rows.filter(r => r.entered_at && new Date(r.entered_at) >= CUTOFF);
        const wouldClose = afterCutoff.filter(r => !r.no_rating || new Date(r.entered_at) < new Date(Date.now() - 5 * 60000));
        console.log(`\nReal FEEDBACK items: ${realFeedback.rows.length} · before 01/09 (kept): ${realFeedback.rows.length - afterCutoff.length} · would close now: ${wouldClose.length} · no anchor: ${realFeedback.rows.filter(r => !r.entered_at).length}`);
        const realOtherBefore = await c.query(`SELECT status, count(*)::int n FROM "BookingItems" WHERE status <> 'FEEDBACK' GROUP BY status ORDER BY status`);

        // ── Fixtures (cloned from a real row so every NOT NULL column is filled) ──
        const tplB = (await c.query(`SELECT id FROM "Bookings" WHERE status = 'DONE' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0].id;
        const tplI = (await c.query(`SELECT id FROM "BookingItems" WHERE "bookingId" = $1 LIMIT 1`, [tplB])).rows[0].id;
        const tplG = (await c.query(`SELECT id FROM "BookingGuests" ORDER BY created_at DESC LIMIT 1`)).rows[0]?.id;

        const addBooking = async (id, status) => {
            await c.query(`CREATE TEMP TABLE IF NOT EXISTS qa_b AS SELECT * FROM "Bookings" WITH NO DATA`);
            await c.query(`TRUNCATE qa_b`);
            await c.query(`INSERT INTO qa_b SELECT * FROM "Bookings" WHERE id = $1`, [tplB]);
            await c.query(`UPDATE qa_b SET id = $1, "billCode" = $1, "accessToken" = $1, status = $2::"BookingStatus", "updatedAt" = (now() AT TIME ZONE 'UTC') - INTERVAL '30 minutes', rating = NULL, parent_booking_id = NULL`, [id, status]);
            await c.query(`INSERT INTO "Bookings" SELECT * FROM qa_b`);
        };
        const addItem = async (id, bookingId, f) => {
            await c.query(`CREATE TEMP TABLE IF NOT EXISTS qa_i AS SELECT * FROM "BookingItems" WITH NO DATA`);
            await c.query(`TRUNCATE qa_i`);
            await c.query(`INSERT INTO qa_i SELECT * FROM "BookingItems" WHERE id = $1`, [tplI]);
            await c.query(`UPDATE qa_i SET id = $1, "bookingId" = $2, status = $3, "itemRating" = $4, segments = $5::jsonb,
                               options = $6::jsonb, handover_submitted_at = $7, "timeEnd" = $8, guest_id = $9,
                               "serviceId" = COALESCE($10, "serviceId"), "technicianCodes" = ARRAY['T011']`,
                [id, bookingId, f.status, f.rating ?? null, JSON.stringify(f.segments ?? null), JSON.stringify(f.options ?? {}),
                 f.handoverAt ?? null, f.timeEnd ?? null, f.guestId ?? null, f.serviceId ?? null]);
            await c.query(`INSERT INTO "BookingItems" SELECT * FROM qa_i`);
        };
        const asString = v => JSON.stringify(v); // jsonb string scalar, like JSON.stringify writes

        const B = n => `${PREFIX}${n}`;
        // BK1: unrated, entered FEEDBACK 10 min ago (segments array) → DONE + flag; booking → DONE
        await addBooking(B(1), 'FEEDBACK');
        await addItem(`${B(1)}-i1`, B(1), { status: 'FEEDBACK', segments: [seg(10)] });
        // BK2: unrated, entered 2 min ago (segments as JSON string) → stays FEEDBACK
        await addBooking(B(2), 'FEEDBACK');
        await addItem(`${B(2)}-i1`, B(2), { status: 'FEEDBACK', segments: asString([seg(2)]) });
        // BK3: rated 4★ 1 min ago → DONE, no flag; sibling CLEANING untouched; booking → CLEANING
        await addBooking(B(3), 'FEEDBACK');
        await addItem(`${B(3)}-i1`, B(3), { status: 'FEEDBACK', rating: 4, segments: [seg(1)] });
        await addItem(`${B(3)}-i2`, B(3), { status: 'CLEANING', segments: [seg(null, { handoverTime: null })], timeEnd: minsAgo(120) });
        // BK4: unrated 10 min (string segs) + CANCELLED + utility WAITING → item DONE, booking DONE
        await addBooking(B(4), 'FEEDBACK');
        await addItem(`${B(4)}-i1`, B(4), { status: 'FEEDBACK', segments: asString([seg(10)]) });
        await addItem(`${B(4)}-i2`, B(4), { status: 'CANCELLED', segments: [], timeEnd: minsAgo(120) });
        await addItem(`${B(4)}-i3`, B(4), { status: 'WAITING', segments: [], serviceId: 'NHS0900' });
        // BK5: no feedbackTime, handover submitted 10 min ago → DONE
        await addBooking(B(5), 'FEEDBACK');
        await addItem(`${B(5)}-i1`, B(5), { status: 'FEEDBACK', segments: [seg(null)], handoverAt: minsAgo(10) });
        // BK6: booking already DONE, FEEDBACK old + CLEANING → item DONE, booking stays DONE
        await addBooking(B(6), 'DONE');
        await addItem(`${B(6)}-i1`, B(6), { status: 'FEEDBACK', segments: [seg(30)] });
        await addItem(`${B(6)}-i2`, B(6), { status: 'CLEANING', segments: [seg(null)] });
        // BK7: guest rated (item rating NULL), entered 1 min ago → DONE, no flag
        let guestCloned = false;
        if (tplG) {
            await addBooking(B(7), 'FEEDBACK');
            await c.query(`CREATE TEMP TABLE qa_g AS SELECT * FROM "BookingGuests" WHERE id = $1`, [tplG]);
            await c.query(`UPDATE qa_g SET id = $1, booking_id = $2, rating = 3, guest_index = 1`, [`${B(7)}-g1`, B(7)]);
            await c.query(`INSERT INTO "BookingGuests" SELECT * FROM qa_g`);
            await addItem(`${B(7)}-i1`, B(7), { status: 'FEEDBACK', segments: [seg(1)], guestId: `${B(7)}-g1` });
            guestCloned = true;
        }
        // BK8: malformed segments string, timeEnd 10 min ago; options stored as JSON string → DONE, options kept + flag
        await addBooking(B(8), 'FEEDBACK');
        await addItem(`${B(8)}-i1`, B(8), { status: 'FEEDBACK', segments: 'not json {', timeEnd: minsAgo(10), options: asString({ displayName: 'Keep me' }) });

        // BK9: unrated, entered FEEDBACK 20/08 (before cutoff) → stays FEEDBACK
        await addBooking(B(9), 'FEEDBACK');
        await addItem(`${B(9)}-i1`, B(9), { status: 'FEEDBACK', segments: [seg(null, { feedbackTime: '2026-08-20T03:00:00.000Z' })] });
        // BK10: entered 31/08 23:30 VN (16:30Z, just before cutoff) → stays; 01/09 00:10 VN → DONE
        await addBooking(B(10), 'FEEDBACK');
        await addItem(`${B(10)}-i1`, B(10), { status: 'FEEDBACK', segments: [seg(null, { feedbackTime: '2026-08-31T16:30:00.000Z' })] });
        await addItem(`${B(10)}-i2`, B(10), { status: 'FEEDBACK', segments: [seg(null, { feedbackTime: '2026-08-31T17:10:00.000Z' })] });

        // ── Run ────────────────────────────────────────────────────
        const run1 = (await c.query('SELECT auto_complete_unrated_feedback() AS n')).rows[0].n;
        const run2 = (await c.query('SELECT auto_complete_unrated_feedback() AS n')).rows[0].n;
        console.log(`\nRun 1 closed ${run1} item(s) (fixtures + real) · run 2 closed ${run2}`);

        const item = async id => (await c.query(`SELECT status, "itemRating", jsonb_unwrap_string(options) AS o FROM "BookingItems" WHERE id = $1`, [id])).rows[0];
        const bk = async id => (await c.query(`SELECT status::text FROM "Bookings" WHERE id = $1`, [id])).rows[0].status;

        console.log('\nFixtures');
        let r = await item(`${B(1)}-i1`);
        check('BK1 unrated 10m → DONE', r.status === 'DONE', JSON.stringify(r));
        check('BK1 itemRating stays NULL', r.itemRating === null);
        check('BK1 flag autoCompletedNoRating', r.o?.autoCompletedNoRating === true && !!r.o?.autoCompletedAt);
        check('BK1 booking → DONE', (await bk(B(1))) === 'DONE');

        r = await item(`${B(2)}-i1`);
        check('BK2 unrated 2m → still FEEDBACK', r.status === 'FEEDBACK', JSON.stringify(r));
        check('BK2 booking unchanged FEEDBACK', (await bk(B(2))) === 'FEEDBACK');

        r = await item(`${B(3)}-i1`);
        check('BK3 rated 1m → DONE', r.status === 'DONE');
        check('BK3 rated → no flag', !r.o?.autoCompletedNoRating);
        check('BK3 sibling CLEANING untouched', (await item(`${B(3)}-i2`)).status === 'CLEANING');
        check('BK3 booking → CLEANING', (await bk(B(3))) === 'CLEANING');

        check('BK4 string segs 10m → DONE', (await item(`${B(4)}-i1`)).status === 'DONE');
        check('BK4 CANCELLED stays CANCELLED', (await item(`${B(4)}-i2`)).status === 'CANCELLED');
        check('BK4 booking → DONE (utility ignored)', (await bk(B(4))) === 'DONE', await bk(B(4)));

        check('BK5 handover_submitted_at anchor → DONE', (await item(`${B(5)}-i1`)).status === 'DONE');

        check('BK6 FEEDBACK item → DONE', (await item(`${B(6)}-i1`)).status === 'DONE');
        check('BK6 CLEANING untouched', (await item(`${B(6)}-i2`)).status === 'CLEANING');
        check('BK6 DONE booking not moved back', (await bk(B(6))) === 'DONE');

        if (guestCloned) {
            r = await item(`${B(7)}-i1`);
            check('BK7 guest rated 1m → DONE', r.status === 'DONE');
            check('BK7 guest rated → no flag', !r.o?.autoCompletedNoRating);
        } else console.log('  ⚠️ BK7 skipped (no BookingGuests template)');

        r = await item(`${B(8)}-i1`);
        check('BK8 malformed segments + timeEnd anchor → DONE', r.status === 'DONE');
        check('BK8 string options unwrapped, data kept + flag', r.o?.displayName === 'Keep me' && r.o?.autoCompletedNoRating === true, JSON.stringify(r.o));

        check('BK9 entered 20/08 → still FEEDBACK (before cutoff)', (await item(`${B(9)}-i1`)).status === 'FEEDBACK');
        check('BK10 31/08 23:30 VN → still FEEDBACK', (await item(`${B(10)}-i1`)).status === 'FEEDBACK');
        check('BK10 01/09 00:10 VN → DONE', (await item(`${B(10)}-i2`)).status === 'DONE');
        check('BK10 booking stays FEEDBACK (one item still waiting)', (await bk(B(10))) === 'FEEDBACK');

        check('Run 2 is a no-op', Number(run2) === 0, `run2=${run2}`);

        console.log('\nReal rows');
        const realOtherAfter = await c.query(`SELECT status, count(*)::int n FROM "BookingItems" WHERE status <> 'FEEDBACK' AND id NOT LIKE '${PREFIX}%' GROUP BY status ORDER BY status`);
        const before = Object.fromEntries(realOtherBefore.rows.map(x => [x.status, x.n]));
        const after = Object.fromEntries(realOtherAfter.rows.map(x => [x.status, x.n]));
        // Fixture items closed: BK1,3,4,5,6,8,10-i2 (+ BK7 when a guest template exists)
        const realClosed = Number(run1) - (guestCloned ? 8 : 7);
        for (const s of Object.keys({ ...before, ...after })) {
            const expected = s === 'DONE' ? (before[s] || 0) + realClosed : (before[s] || 0);
            check(`real ${s}: ${before[s] || 0} → ${after[s] || 0}`, (after[s] || 0) === expected, `expected ${expected}`);
        }
        check('real items closed = dry-run estimate', realClosed === wouldClose.length, `closed ${realClosed} vs estimate ${wouldClose.length}`);
    } catch (e) {
        failed++;
        console.error('💥', e.message);
    } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
        console.log(`\n${passed} passed · ${failed} failed · transaction ROLLED BACK`);
        process.exit(failed ? 1 : 0);
    }
})();
