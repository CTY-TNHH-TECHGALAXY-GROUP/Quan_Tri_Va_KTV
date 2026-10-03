/**
 * ================================================================
 * BACKFILL: KTV reports → card action log (one-off, 14/09/2026)
 * ================================================================
 * Before 14/09 a KTV pressing "Khách về sớm" / "Báo động khẩn cấp" only left a
 * bare "Tạm dừng" on the Kanban card. The report itself was saved in
 * StaffNotifications — copy it into `BookingItems.options.counterLog` as
 * KTV_EARLY_EXIT / KTV_EMERGENCY so old cards read "T007 Khách về sớm".
 *
 *  · EMERGENCY only when it is the alarm button ("🚨 KHẨN CẤP…"), not a
 *    room-issue report (custom message, does not stop the order).
 *  · Only items that KTV is on, and only finished items (never running ones —
 *    their options are being written live).
 *  · Reports sent before 02/07 carry no KTV code (old app) → cannot be attributed, skipped.
 *  · Skips when the same report by the same KTV is already logged within 30s
 *    (idempotent; also collapses double taps).
 *
 * Run:  node scripts/backfill_ktv_reports_to_counter_log.cjs          (dry run)
 *       node scripts/backfill_ktv_reports_to_counter_log.cjs --apply  (write)
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
const get = k => (env.split('\n').find(l => l.startsWith(k + '=')) || '').slice(k.length + 1).trim().replace(/^"|"$/g, '');
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SECRET_KEY'));

const APPLY = process.argv.includes('--apply');
// Same report by the same KTV within 30s = already logged or a double tap (real data: ≤ 13s).
// Wider would swallow a genuine second press after the counter resumed.
const WINDOW_MS = 30000;
const FINISHED = ['DONE', 'CANCELLED', 'FEEDBACK', 'CLEANING', 'COMPLETED'];

const parse = v => {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
    return v;
};

(async () => {
    const notifs = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('StaffNotifications')
            .select('bookingId, employeeId, type, message, createdAt')
            .in('type', ['EARLY_EXIT', 'EMERGENCY'])
            .not('bookingId', 'is', null)
            .order('createdAt', { ascending: true })
            .range(from, from + 999);
        if (error) throw error;
        notifs.push(...data);
        if (data.length < 1000) break;
    }

    const reports = notifs
        .filter(n => n.type === 'EARLY_EXIT' || String(n.message || '').startsWith('🚨 KHẨN CẤP'))
        .map(n => ({ ...n, action: n.type === 'EARLY_EXIT' ? 'KTV_EARLY_EXIT' : 'KTV_EMERGENCY' }));
    console.log(`Reports found: ${reports.length} (EARLY_EXIT ${reports.filter(r => r.action === 'KTV_EARLY_EXIT').length}, alarm ${reports.filter(r => r.action === 'KTV_EMERGENCY').length})`);

    const byBooking = new Map();
    for (const r of reports) {
        if (!byBooking.has(r.bookingId)) byBooking.set(r.bookingId, []);
        byBooking.get(r.bookingId).push(r);
    }

    let added = 0, skippedLive = 0, skippedDup = 0, noItem = 0;
    const touched = [];
    for (const [bookingId, list] of byBooking) {
        const { data: items, error } = await sb.from('BookingItems')
            .select('id, status, options, "technicianCodes"').eq('bookingId', bookingId);
        if (error) throw error;

        const changed = new Map();
        for (const r of list) {
            const code = String(r.employeeId || '').trim().toUpperCase();
            const mine = (items || []).filter(i => code && (i.technicianCodes || []).some(c => String(c).trim().toUpperCase() === code));
            if (mine.length === 0) { noItem++; continue; }

            for (const it of mine) {
                if (!FINISHED.includes(String(it.status))) { skippedLive++; continue; }
                const opts = changed.get(it.id) || parse(it.options) || {};
                const log = Array.isArray(opts.counterLog) ? opts.counterLog : [];
                const at = new Date(r.createdAt).toISOString();
                const dup = log.some(e => e && e.action === r.action
                    && String(e.by || '').toUpperCase() === code
                    && Math.abs(new Date(e.at).getTime() - new Date(at).getTime()) <= WINDOW_MS);
                if (dup) { skippedDup++; continue; }

                log.push({ action: r.action, by: r.employeeId, byName: r.employeeId, at, backfilled: true });
                log.sort((a, b) => (new Date(a && a.at).getTime() || 0) - (new Date(b && b.at).getTime() || 0));
                opts.counterLog = log;
                changed.set(it.id, opts);
                added++;
                touched.push(`${it.id} ${r.employeeId} ${r.action} ${at}`);
            }
        }

        if (APPLY) {
            for (const [id, opts] of changed) {
                const { error: upErr } = await sb.from('BookingItems').update({ options: opts }).eq('id', id);
                if (upErr) throw upErr;
            }
        }
    }

    touched.slice(0, 30).forEach(l => console.log('  +', l));
    if (touched.length > 30) console.log(`  … ${touched.length - 30} more`);
    console.log(`\n${APPLY ? 'WRITTEN' : 'DRY RUN'} · entries added: ${added} · skipped running item: ${skippedLive} · already logged / double tap: ${skippedDup} · KTV not on any item: ${noItem}`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
