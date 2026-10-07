/**
 * Chụp trạng thái cho việc chuẩn hoá BookingItems.segments (CHỈ ĐỌC).
 * node scripts/qa/seg_snapshot.js <envFile> <outJson>
 * Ghi: số dòng sổ/hàng đợi KTV, KTVDRecomputeQueue, tổng dispatchRevision, tổng mục dispatchHistory,
 * số dòng segments dạng chuỗi, checksum NỘI DUNG chặng (sau gỡ chuỗi) toàn bảng + từng dòng.
 */
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../../../');
const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const envFile = process.argv[2]; const out = process.argv[3];
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const TABLES = ['TurnQueue', 'KtvAssignments', 'TurnLedger', 'KTVDTurnLedger', 'KTVServiceHoursLedger', 'WalletAdjustments', 'KTVBonusLedger', 'KTVPiggyBankLedger', 'StaffNotifications', 'KTVDRecomputeQueue'];
(async () => {
  const c = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query('SET default_transaction_read_only = on');
  const snap = { db: (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/https:\/\/([a-z]{6}).*/, '$1…'), at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) { try { snap.tables[t] = Number((await c.query(`SELECT count(*) n FROM "${t}"`)).rows[0].n); } catch (e) { snap.tables[t] = 'không có bảng'; } }
  const r = await c.query(`SELECT count(*) total,
      count(*) FILTER (WHERE jsonb_typeof(segments)='string') str,
      count(*) FILTER (WHERE jsonb_typeof(segments)='string' AND status IN ('IN_PROGRESS','PAUSED')) str_running,
      coalesce(sum(coalesce((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0)),0) rev_sum,
      coalesce(sum(coalesce(jsonb_array_length(jsonb_unwrap_string(options)->'dispatchHistory'),0)),0) hist_sum,
      md5(string_agg(id || ':' || coalesce(jsonb_unwrap_string(segments)::text,'null'), '|' ORDER BY id)) content_md5
    FROM "BookingItems"`);
  Object.assign(snap, Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])));
  const rows = await c.query(`SELECT id, md5(coalesce(jsonb_unwrap_string(segments)::text,'null')) h FROM "BookingItems"`);
  snap.rowHashes = Object.fromEntries(rows.rows.map(x => [x.id, x.h]));
  await c.end();
  fs.writeFileSync(out, JSON.stringify(snap));
  const { rowHashes, ...brief } = snap; console.log(JSON.stringify(brief, null, 1));
})().catch(e => { console.error('LỖI', e.message); process.exit(1); });
