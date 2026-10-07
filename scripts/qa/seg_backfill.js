/**
 * Đổi BookingItems.segments dạng CHUỖI → MẢNG cho dữ liệu cũ.
 * node scripts/qa/seg_backfill.js <envFile> <backupDir> [--apply]   (mặc định: chỉ đếm, không ghi)
 *  - Lô 500 dòng; mỗi lô 1 transaction `SET LOCAL session_replication_role = replica` → KHÔNG kích trigger nào
 *    (không đẩy KTVDRecomputeQueue / tiền Loại D, không tăng dispatchRevision, không ghi lịch sử).
 *  - Bỏ qua dòng IN_PROGRESS / PAUSED (trigger aa_normalize_segments tự đổi ở lần ghi kế tiếp).
 *  - Chỉ ghi khi nội dung sau gỡ chuỗi là MẢNG; lưu file backup (id + segments gốc) trước mỗi lô.
 */
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../../../');
const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const envOf = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const [envFile, backupDir] = process.argv.slice(2); const apply = process.argv.includes('--apply');
const E = envOf(envFile); const db = E.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z]+)\./)[1];
const BATCH = 500;
(async () => {
  const c = new Client({ connectionString: E.DIRECT_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  const ids = (await c.query(`SELECT id FROM "BookingItems" WHERE jsonb_typeof(segments)='string'
      AND status NOT IN ('IN_PROGRESS','PAUSED') AND jsonb_typeof(jsonb_unwrap_string(segments))='array' ORDER BY id`)).rows.map(r => r.id);
  console.log(`[${db}] cần đổi: ${ids.length} dòng (${Math.ceil(ids.length / BATCH)} lô)${apply ? '' : ' — CHẠY THỬ, không ghi'}`);
  if (!apply) { await c.end(); return; }
  fs.mkdirSync(backupDir, { recursive: true });
  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const lot = ids.slice(i, i + BATCH);
    const before = await c.query(`SELECT id, segments::text s FROM "BookingItems" WHERE id = ANY($1)`, [lot]);
    fs.writeFileSync(path.join(backupDir, `${db}_lot_${String(i / BATCH + 1).padStart(3, '0')}.json`), JSON.stringify(before.rows));
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica');
    const r = await c.query(`UPDATE "BookingItems" SET segments = jsonb_unwrap_string(segments)
        WHERE id = ANY($1) AND jsonb_typeof(segments)='string' AND jsonb_typeof(jsonb_unwrap_string(segments))='array'`, [lot]);
    await c.query('COMMIT');
    done += r.rowCount; console.log(`  lô ${i / BATCH + 1}: ${r.rowCount} dòng`);
    await new Promise(res => setTimeout(res, 300));
  }
  console.log(`Đã đổi ${done}/${ids.length} dòng. Backup: ${backupDir}`);
  await c.end();
})().catch(e => { console.error('LỖI', e.message); process.exit(1); });
