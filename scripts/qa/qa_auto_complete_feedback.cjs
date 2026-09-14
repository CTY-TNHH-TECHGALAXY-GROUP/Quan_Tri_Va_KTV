/**
 * ================================================================
 * TEST: auto_complete_unrated_feedback() on the real DB — ROLLED BACK
 * ================================================================
 * Everything runs inside ONE transaction that always ends in ROLLBACK:
 * the functions are created, fixtures inserted, the job run, results checked,
 * then all of it disappears. Triggers are disabled for the transaction
 * (session_replication_role = replica) so no push/notification side effects.
 *
 * Also a dry run on real rows (auto_complete_feedback_candidates): prints how
 * many real items the job would close, and asserts no real non-FEEDBACK item
 * changes status.
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
// 20260914180000 replaces the job with the "whole child order finished" rules.
const GUARD_MIGRATION = path.resolve('supabase/migrations/20260914180000_auto_complete_require_all_segments_done.sql');
const FUNCTION_SQL = fs.readFileSync(MIGRATION, 'utf-8').split('-- @@CRON_SECTION@@')[0]
    + '\n' + fs.readFileSync(GUARD_MIGRATION, 'utf-8');

const PREFIX = 'QA-AUTOFB-';
const minsAgo = m => new Date(Date.now() - m * 60000).toISOString();
/** A finished segment; `fbMinsAgo` = when it entered FEEDBACK (null = no feedbackTime). */
const seg = (fbMinsAgo, extra = {}) => ({
    id: 'seg1', ktvId: 'T011', actualStartTime: minsAgo(80), actualEndTime: minsAgo(20),
    handoverTime: minsAgo(15), ...(fbMinsAgo != null ? { feedbackTime: minsAgo(fbMinsAgo) } : {}), ...extra,
});
/** A second KTV's segment in a sequence — open unless `extra` finishes it. */
const nextSeg = extra => ({ id: 'seg2', ktvId: 'NH021', startTime: '16:20', endTime: '17:20', duration: 60, ...extra });
const working = () => [{ id: 'seg1', ktvId: 'T014', actualStartTime: minsAgo(15) }];

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
        // Baseline 5 minutes regardless of what the manager has set (rolled back).
        await c.query(`UPDATE "SystemConfigs" SET value = '5'::jsonb WHERE key = 'customer_rating_timeout_minutes'`);

        // ── Real-row dry run (same function the job uses) ──────────────
        const realFeedbackCount = (await c.query(`SELECT count(*)::int n FROM "BookingItems" WHERE status = 'FEEDBACK'`)).rows[0].n;
        const wouldClose = (await c.query(`SELECT item_id FROM auto_complete_feedback_candidates(5)`)).rows.length;
        console.log(`\nReal FEEDBACK items: ${realFeedbackCount} · would close now: ${wouldClose}`);
        const realOtherBefore = await c.query(`SELECT status, count(*)::int n FROM "BookingItems" WHERE status <> 'FEEDBACK' GROUP BY status ORDER BY status`);

        // ── Fixtures (cloned from a real row so every NOT NULL column is filled) ──
        const tplB = (await c.query(`SELECT id FROM "Bookings" WHERE status = 'DONE' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0].id;
        const tplI = (await c.query(`SELECT id FROM "BookingItems" WHERE "bookingId" = $1 LIMIT 1`, [tplB])).rows[0].id;
        const tplG = (await c.query(`SELECT id FROM "BookingGuests" ORDER BY created_at DESC LIMIT 1`)).rows[0]?.id;

        await c.query(`CREATE TEMP TABLE qa_b AS SELECT * FROM "Bookings" WITH NO DATA`);
        await c.query(`CREATE TEMP TABLE qa_i AS SELECT * FROM "BookingItems" WITH NO DATA`);
        const addBooking = async (id, status) => {
            await c.query(`TRUNCATE qa_b`);
            await c.query(`INSERT INTO qa_b SELECT * FROM "Bookings" WHERE id = $1`, [tplB]);
            await c.query(`UPDATE qa_b SET id = $1, "billCode" = $1, "accessToken" = $1, status = $2::"BookingStatus", "updatedAt" = (now() AT TIME ZONE 'UTC') - INTERVAL '30 minutes', rating = NULL, parent_booking_id = NULL`, [id, status]);
            await c.query(`INSERT INTO "Bookings" SELECT * FROM qa_b`);
        };
        const addItem = async (id, bookingId, f) => {
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

        // Single-service orders
        await addBooking(B(1), 'FEEDBACK');                                   // unrated, 10m → DONE
        await addItem(`${B(1)}-i1`, B(1), { status: 'FEEDBACK', segments: [seg(10)] });
        await addBooking(B(2), 'FEEDBACK');                                   // unrated, 2m → wait
        await addItem(`${B(2)}-i1`, B(2), { status: 'FEEDBACK', segments: asString([seg(2)]) });
        await addBooking(B(5), 'FEEDBACK');                                   // handover_submitted_at anchor → DONE
        await addItem(`${B(5)}-i1`, B(5), { status: 'FEEDBACK', segments: [seg(null)], handoverAt: minsAgo(10) });
        await addBooking(B(8), 'FEEDBACK');                                   // no segments, timeEnd anchor, string options → DONE
        await addItem(`${B(8)}-i1`, B(8), { status: 'FEEDBACK', segments: [], timeEnd: minsAgo(10), options: asString({ displayName: 'Keep me' }) });
        await addBooking(B(9), 'FEEDBACK');                                   // before 01/09 cutoff → wait
        await addItem(`${B(9)}-i1`, B(9), { status: 'FEEDBACK', segments: [seg(null, { feedbackTime: '2026-08-20T03:00:00.000Z' })] });
        await addBooking(B(10), 'FEEDBACK');                                  // 31/08 23:30 VN → wait
        await addItem(`${B(10)}-i1`, B(10), { status: 'FEEDBACK', segments: [seg(null, { feedbackTime: '2026-08-31T16:30:00.000Z' })] });
        await addBooking(B(18), 'FEEDBACK');                                  // 01/09 00:10 VN → DONE
        await addItem(`${B(18)}-i1`, B(18), { status: 'FEEDBACK', segments: [seg(null, { feedbackTime: '2026-08-31T17:10:00.000Z' })] });
        let guestCloned = false;
        if (tplG) {                                                           // guest rated 1m → DONE now, no flag
            await addBooking(B(7), 'FEEDBACK');
            await c.query(`CREATE TEMP TABLE qa_g AS SELECT * FROM "BookingGuests" WHERE id = $1`, [tplG]);
            await c.query(`UPDATE qa_g SET id = $1, booking_id = $2, rating = 3, guest_index = 1`, [`${B(7)}-g1`, B(7)]);
            await c.query(`INSERT INTO "BookingGuests" SELECT * FROM qa_g`);
            await addItem(`${B(7)}-i1`, B(7), { status: 'FEEDBACK', segments: [seg(1)], guestId: `${B(7)}-g1` });
            guestCloned = true;
        }

        // One service, KTVs in sequence (incident 14/09)
        await addBooking(B(14), 'FEEDBACK');                                  // next KTV started, not finished → wait
        await addItem(`${B(14)}-i1`, B(14), { status: 'FEEDBACK', segments: [seg(10), nextSeg({ actualStartTime: minsAgo(10) })] });
        await addBooking(B(15), 'FEEDBACK');                                  // next KTV never started → wait
        await addItem(`${B(15)}-i1`, B(15), { status: 'FEEDBACK', segments: asString([seg(10), nextSeg({})]) });
        await addBooking(B(16), 'FEEDBACK');                                  // next KTV voided → ignored → DONE
        await addItem(`${B(16)}-i1`, B(16), { status: 'FEEDBACK', segments: [seg(10), nextSeg({ actualStartTime: minsAgo(30), voided: true, note: 'CHANGED' })] });
        await addBooking(B(17), 'FEEDBACK');                                  // unreadable segments → wait
        await addItem(`${B(17)}-i1`, B(17), { status: 'FEEDBACK', segments: 'not json {', timeEnd: minsAgo(10) });
        await addBooking(B(25), 'FEEDBACK');                                  // next KTV finished 7m ago → DONE
        await addItem(`${B(25)}-i1`, B(25), { status: 'FEEDBACK', segments: [seg(20), nextSeg({ actualStartTime: minsAgo(40), actualEndTime: minsAgo(8), feedbackTime: minsAgo(7) })] });

        // Several services in one child order — wait for the whole order
        await addBooking(B(3), 'IN_PROGRESS');                                // rated svc + svc still CLEANING → wait
        await addItem(`${B(3)}-i1`, B(3), { status: 'FEEDBACK', rating: 4, segments: [seg(10)] });
        await addItem(`${B(3)}-i2`, B(3), { status: 'CLEANING', segments: [seg(null)], timeEnd: minsAgo(12) });
        await addBooking(B(4), 'FEEDBACK');                                   // + CANCELLED + utility WAITING → DONE
        await addItem(`${B(4)}-i1`, B(4), { status: 'FEEDBACK', segments: asString([seg(10)]) });
        await addItem(`${B(4)}-i2`, B(4), { status: 'CANCELLED', segments: [], timeEnd: minsAgo(120) });
        await addItem(`${B(4)}-i3`, B(4), { status: 'WAITING', segments: [], serviceId: 'NHS0900' });
        await addBooking(B(6), 'DONE');                                       // other svc already DONE → close; booking stays DONE
        await addItem(`${B(6)}-i1`, B(6), { status: 'FEEDBACK', segments: [seg(30)] });
        await addItem(`${B(6)}-i2`, B(6), { status: 'DONE', segments: [seg(20)] });
        await addBooking(B(20), 'IN_PROGRESS');                               // KTV A done 10m, KTV B still working → wait
        await addItem(`${B(20)}-i1`, B(20), { status: 'FEEDBACK', segments: [seg(10)] });
        await addItem(`${B(20)}-i2`, B(20), { status: 'IN_PROGRESS', segments: working() });
        await addBooking(B(21), 'FEEDBACK');                                  // A done 10m, B done 2m → wait from B
        await addItem(`${B(21)}-i1`, B(21), { status: 'FEEDBACK', segments: [seg(10)] });
        await addItem(`${B(21)}-i2`, B(21), { status: 'FEEDBACK', segments: [seg(2, { ktvId: 'T014' })] });
        await addBooking(B(22), 'FEEDBACK');                                  // A done 12m, B done 7m → both DONE together
        await addItem(`${B(22)}-i1`, B(22), { status: 'FEEDBACK', segments: [seg(12)] });
        await addItem(`${B(22)}-i2`, B(22), { status: 'FEEDBACK', segments: [seg(7, { ktvId: 'T014' })] });
        await addBooking(B(23), 'IN_PROGRESS');                               // A done 10m, B PAUSED → wait
        await addItem(`${B(23)}-i1`, B(23), { status: 'FEEDBACK', segments: [seg(10)] });
        await addItem(`${B(23)}-i2`, B(23), { status: 'PAUSED', segments: working() });

        // ── Run ────────────────────────────────────────────────────
        const run1 = Number((await c.query('SELECT auto_complete_unrated_feedback() AS n')).rows[0].n);
        const run2 = Number((await c.query('SELECT auto_complete_unrated_feedback() AS n')).rows[0].n);
        console.log(`\nRun 1 closed ${run1} item(s) (fixtures + real) · run 2 closed ${run2}`);

        const item = async id => (await c.query(`SELECT status, "itemRating", jsonb_unwrap_string(options) AS o FROM "BookingItems" WHERE id = $1`, [id])).rows[0];
        const st = async id => (await item(id)).status;
        const bk = async id => (await c.query(`SELECT status::text FROM "Bookings" WHERE id = $1`, [id])).rows[0].status;

        console.log('\nSingle-service orders');
        let r = await item(`${B(1)}-i1`);
        check('unrated, finished 10m → DONE', r.status === 'DONE', JSON.stringify(r));
        check('itemRating stays NULL', r.itemRating === null);
        check('flag autoCompletedNoRating + autoCompletedAt', r.o?.autoCompletedNoRating === true && !!r.o?.autoCompletedAt);
        check('booking → DONE', (await bk(B(1))) === 'DONE');
        check('unrated, finished 2m → still FEEDBACK', (await st(`${B(2)}-i1`)) === 'FEEDBACK');
        check('handover_submitted_at anchor → DONE', (await st(`${B(5)}-i1`)) === 'DONE');
        r = await item(`${B(8)}-i1`);
        check('no segments + timeEnd anchor → DONE', r.status === 'DONE');
        check('string options unwrapped, data kept + flag', r.o?.displayName === 'Keep me' && r.o?.autoCompletedNoRating === true, JSON.stringify(r.o));
        check('entered 20/08 → still FEEDBACK (cutoff)', (await st(`${B(9)}-i1`)) === 'FEEDBACK');
        check('31/08 23:30 VN → still FEEDBACK', (await st(`${B(10)}-i1`)) === 'FEEDBACK');
        check('01/09 00:10 VN → DONE', (await st(`${B(18)}-i1`)) === 'DONE');
        if (guestCloned) {
            r = await item(`${B(7)}-i1`);
            check('guest rated 1m → DONE now', r.status === 'DONE');
            check('guest rated → no flag', !r.o?.autoCompletedNoRating);
        } else console.log('  ⚠️ guest case skipped (no BookingGuests template)');

        console.log('\nOne service, KTVs in sequence (incident 14/09)');
        check('next KTV started, not finished → still FEEDBACK', (await st(`${B(14)}-i1`)) === 'FEEDBACK');
        check('  booking unchanged FEEDBACK', (await bk(B(14))) === 'FEEDBACK');
        check('next KTV never started → still FEEDBACK', (await st(`${B(15)}-i1`)) === 'FEEDBACK');
        check('next KTV voided → ignored → DONE', (await st(`${B(16)}-i1`)) === 'DONE');
        check('unreadable segments → still FEEDBACK', (await st(`${B(17)}-i1`)) === 'FEEDBACK');
        check('next KTV finished 7m ago → DONE', (await st(`${B(25)}-i1`)) === 'DONE');

        console.log('\nSeveral services in one child order');
        check('rated svc waits while other svc is CLEANING', (await st(`${B(3)}-i1`)) === 'FEEDBACK');
        check('  CLEANING svc untouched', (await st(`${B(3)}-i2`)) === 'CLEANING');
        check('+ CANCELLED + utility WAITING → DONE', (await st(`${B(4)}-i1`)) === 'DONE');
        check('  CANCELLED stays CANCELLED', (await st(`${B(4)}-i2`)) === 'CANCELLED');
        check('  booking → DONE (utility ignored)', (await bk(B(4))) === 'DONE', await bk(B(4)));
        check('other svc already DONE → close', (await st(`${B(6)}-i1`)) === 'DONE');
        check('  DONE booking not moved back', (await bk(B(6))) === 'DONE');
        check('KTV B still working → A waits (FEEDBACK)', (await st(`${B(20)}-i1`)) === 'FEEDBACK');
        check('  B untouched IN_PROGRESS', (await st(`${B(20)}-i2`)) === 'IN_PROGRESS');
        check('A 10m, B 2m → A waits for B', (await st(`${B(21)}-i1`)) === 'FEEDBACK');
        check('  B still FEEDBACK', (await st(`${B(21)}-i2`)) === 'FEEDBACK');
        check('A 12m, B 7m → A DONE', (await st(`${B(22)}-i1`)) === 'DONE');
        check('  B DONE together', (await st(`${B(22)}-i2`)) === 'DONE');
        check('  booking → DONE', (await bk(B(22))) === 'DONE');
        check('KTV B PAUSED → A waits', (await st(`${B(23)}-i1`)) === 'FEEDBACK');

        check('run 2 is a no-op', run2 === 0, `run2=${run2}`);

        console.log('\nReal rows');
        // Fixture items closed by run 1: B1,B5,B8,B18,B16,B25,B4,B6,B22×2 (+ B7 guest)
        const fixturesClosed = 10 + (guestCloned ? 1 : 0);
        const realClosed = run1 - fixturesClosed;
        const realOtherAfter = await c.query(`SELECT status, count(*)::int n FROM "BookingItems" WHERE status <> 'FEEDBACK' AND id NOT LIKE '${PREFIX}%' GROUP BY status ORDER BY status`);
        const before = Object.fromEntries(realOtherBefore.rows.map(x => [x.status, x.n]));
        const after = Object.fromEntries(realOtherAfter.rows.map(x => [x.status, x.n]));
        for (const s of Object.keys({ ...before, ...after })) {
            const expected = s === 'DONE' ? (before[s] || 0) + realClosed : (before[s] || 0);
            check(`real ${s}: ${before[s] || 0} → ${after[s] || 0}`, (after[s] || 0) === expected, `expected ${expected}`);
        }
        check('real items closed = dry-run estimate', realClosed === wouldClose, `closed ${realClosed} vs estimate ${wouldClose}`);

        // Runs after the real-row comparison: changing the wait could close more real rows.
        console.log('\nConfigurable wait (SystemConfigs.customer_rating_timeout_minutes)');
        const setWait = v => c.query(`UPDATE "SystemConfigs" SET value = $1::jsonb WHERE key = 'customer_rating_timeout_minutes'`, [JSON.stringify(v)]);
        const runJob = () => c.query('SELECT auto_complete_unrated_feedback()');

        await addBooking(B(11), 'FEEDBACK');
        await addItem(`${B(11)}-i1`, B(11), { status: 'FEEDBACK', segments: [seg(10)] });
        await setWait(20); await runJob();
        check('wait 20m: finished 10m ago → still FEEDBACK', (await st(`${B(11)}-i1`)) === 'FEEDBACK');
        await setWait(8); await runJob();
        check('wait 8m: finished 10m ago → DONE', (await st(`${B(11)}-i1`)) === 'DONE');

        await addBooking(B(12), 'FEEDBACK');
        await addItem(`${B(12)}-i1`, B(12), { status: 'FEEDBACK', segments: [seg(1)] });
        await setWait(0); await runJob();
        check('wait 0: finished 1m ago → DONE right away', (await st(`${B(12)}-i1`)) === 'DONE');

        await addBooking(B(13), 'FEEDBACK');
        await addItem(`${B(13)}-i1`, B(13), { status: 'FEEDBACK', segments: [seg(6)] });
        await addBooking(B(24), 'FEEDBACK');
        await addItem(`${B(24)}-i1`, B(24), { status: 'FEEDBACK', segments: [seg(3)] });
        await setWait('abc'); await runJob();
        check('unreadable value → fallback 5m: 6m ago DONE', (await st(`${B(13)}-i1`)) === 'DONE');
        check('unreadable value → fallback 5m: 3m ago still FEEDBACK', (await st(`${B(24)}-i1`)) === 'FEEDBACK');
        await setWait(-3); await runJob();
        check('negative value → fallback 5m: 3m ago still FEEDBACK', (await st(`${B(24)}-i1`)) === 'FEEDBACK');
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
