/**
 * ================================================================
 * ONE-OFF REPAIR 14/09/2026: early-finished items stuck with a never-started KTV
 * ================================================================
 * Before the fix, "Kết thúc sớm" left the segment of a KTV who had not started
 * open, so the item was pulled back to IN_PROGRESS forever.
 * Applies the new rule to those items only:
 *   · never-started segment → closed, voided, 0 minutes, note EARLY_LEAVE_NOT_STARTED
 *     (same fields as markNotStartedOnEarlyLeave in lib/segment-time.ts)
 *   · item status re-decided like handleFinishService (voided segments ignored):
 *     all worked segments done + handed over → DONE if rated, else FEEDBACK;
 *     done but not handed over → CLEANING
 *   · the auto-complete job then closes FEEDBACK items after the wait.
 * TurnQueue / turns are NOT touched: these are past business days.
 *
 * Run:  node scripts/repair_early_leave_not_started.cjs          (dry run, ROLLBACK)
 *       node scripts/repair_early_leave_not_started.cjs --apply  (COMMIT)
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
const get = k => (env.split('\n').find(l => l.startsWith(k + '=')) || '').slice(k.length + 1).trim().replace(/^"|"$/g, '');
const APPLY = process.argv.includes('--apply');

const parse = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; };

(async () => {
    const c = new Client({ connectionString: get('DIRECT_URL') || get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
    await c.connect();
    try {
        await c.query('BEGIN');
        const { rows } = await c.query(`
            SELECT i.id, i."bookingId", i.status, i."itemRating", i.segments, g.rating AS guest_rating, b.rating AS booking_rating
              FROM "BookingItems" i
              JOIN "Bookings" b ON b.id = i."bookingId"
              LEFT JOIN "BookingGuests" g ON g.id = i.guest_id
             WHERE jsonb_unwrap_string(i.options) ->> 'earlyLeave' = 'true'
               AND i.status NOT IN ('CANCELLED', 'DONE')
             FOR UPDATE OF i`);

        let changed = 0;
        for (const r of rows) {
            const segs = parse(r.segments);
            if (!Array.isArray(segs)) continue;
            const notStarted = segs.filter(s => s && s.ktvId && !s.actualStartTime && !s.actualEndTime && s.voided !== true);
            if (notStarted.length === 0) continue;

            const endMark = segs.map(s => s.actualEndTime).filter(Boolean).sort().pop() || new Date().toISOString();
            for (const s of notStarted) {
                s.actualEndTime = endMark;
                s.customCommissionDuration = 0;
                s.voided = true;
                s.note = 'EARLY_LEAVE_NOT_STARTED';
            }

            const live = segs.filter(s => s && s.voided !== true);
            const started = live.filter(s => s.actualStartTime);
            const allDone = started.length > 0 && started.every(s => s.actualEndTime);
            const handedOver = started.length > 0 && started.every(s => s.handoverTime);
            const rated = r.itemRating != null || r.guest_rating != null || r.booking_rating != null;
            const newStatus = !allDone ? r.status : handedOver ? (rated ? 'DONE' : 'FEEDBACK') : 'CLEANING';

            console.log(`${r.id} (${r.bookingId}): ${r.status} → ${newStatus} · tước ${notStarted.map(s => s.ktvId).join(', ')} · mốc ${endMark}`);
            await c.query(`UPDATE "BookingItems" SET segments = $1::jsonb, status = $2 WHERE id = $3`, [JSON.stringify(segs), newStatus, r.id]);
            changed++;
        }

        if (APPLY) { await c.query('COMMIT'); console.log(`\n✅ COMMITTED · ${changed} item(s)`); }
        else { await c.query('ROLLBACK'); console.log(`\nDRY RUN (rolled back) · ${changed} item(s) would change`); }
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        console.error('💥', e.message);
        process.exit(1);
    } finally {
        await c.end();
    }
})();
