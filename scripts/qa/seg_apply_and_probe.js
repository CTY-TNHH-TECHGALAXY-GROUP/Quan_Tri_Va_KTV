/**
 * Áp migration chuẩn hoá lên DB TEST rồi ghi thử 4 dạng segments (chuỗi, mảng, null, chuỗi hỏng) + sửa dòng nối tiếp.
 * node scripts/qa/seg_apply_and_probe.js <testEnv> <migration.sql>
 */
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../../../');
const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const envOf = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const [testEnv, sqlFile] = process.argv.slice(2);
const T = envOf(testEnv); if (!T.NEXT_PUBLIC_SUPABASE_URL.includes('eknggruuiuadwldacpmb')) throw new Error('DỪNG: không phải DB TEST');
(async () => {
  const c = new Client({ connectionString: T.DIRECT_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  await c.query(fs.readFileSync(sqlFile, 'utf8'));
  const trg = await c.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='"BookingItems"'::regclass AND NOT tgisinternal AND tgname LIKE 'aa_%'`);
  console.log('Trigger đã tạo:', trg.rows.map(r => r.tgname).join(','));
  const id = 'QA-SEGP-' + Date.now().toString(36);
  const res = [];
  const typeOf = async (iid) => (await c.query(`SELECT jsonb_typeof(segments) t, segments::text s FROM "BookingItems" WHERE id=$1`, [iid])).rows[0];
  await c.query(`INSERT INTO "Bookings"(id,"billCode","customerName",status,source,"bookingDate","guestCount","totalAmount","createdAt","updatedAt") VALUES($1,$1,'QA probe','NEW','STANDARD_WALK_IN',now(),1,0,now(),now())`, [id]);
  const seg = [{ id: 's1', ktvId: 'SEQ_TEST_A', startTime: '20:00', endTime: '21:00', duration: 60 }];
  const cases = [
    ['INSERT chuỗi JSON (như app ghi)', JSON.stringify(JSON.stringify(seg)), 'array'],
    ['INSERT mảng', JSON.stringify(seg), 'array'],
    ['INSERT null', null, null],
    ['INSERT chuỗi hỏng "abc{"', JSON.stringify('abc{'), 'string'],
    ["INSERT chuỗi '[]' (như thêm phát sinh)", JSON.stringify('[]'), 'array'],
  ];
  let k = 0;
  for (const [label, val, expect] of cases) {
    const iid = `${id}-${++k}`;
    try {
      await c.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",quantity,price,status,segments,"technicianCodes",options) VALUES($1,$2,'NHS0101',1,0,'NEW',$3::jsonb,'{}'::text[],'{}'::jsonb)`, [iid, id, val]);
      const t = await typeOf(iid); res.push({ ca: label, ghi_duoc: 'có', luu_thanh: t.t, ok: t.t === expect ? 'ĐẠT' : 'HỎNG' });
    } catch (e) { res.push({ ca: label, ghi_duoc: 'KHÔNG: ' + e.message.slice(0, 60), luu_thanh: '-', ok: 'HỎNG' }); }
  }
  // UPDATE: dòng mảng bị app ghi lại dạng chuỗi (như KTV bắt đầu / kết thúc)
  const u = `${id}-2`;
  await c.query(`UPDATE "BookingItems" SET segments=$2::jsonb WHERE id=$1`, [u, JSON.stringify(JSON.stringify([{ ...seg[0], actualStartTime: new Date().toISOString() }]))]);
  const tu = await typeOf(u); res.push({ ca: 'UPDATE ghi chuỗi (KTV bắt đầu)', ghi_duoc: 'có', luu_thanh: tu.t, ok: tu.t === 'array' && tu.s.includes('actualStartTime') ? 'ĐẠT' : 'HỎNG' });
  // UPDATE không đụng segments → trigger không chạy
  await c.query(`UPDATE "BookingItems" SET price=1 WHERE id=$1`, [`${id}-4`]);
  const tn = await typeOf(`${id}-4`); res.push({ ca: 'UPDATE cột khác trên dòng chuỗi hỏng', ghi_duoc: 'có', luu_thanh: tn.t, ok: tn.t === 'string' ? 'ĐẠT' : 'HỎNG' });
  console.table(res);
  await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica');
  await c.query(`DELETE FROM "BookingItems" WHERE "bookingId"=$1`, [id]); await c.query(`DELETE FROM "Bookings" WHERE id=$1`, [id]);
  await c.query(`DELETE FROM "KTVDRecomputeQueue" WHERE booking_id=$1`, [id]).catch(() => {});
  await c.query('COMMIT');
  console.log(res.every(r => r.ok === 'ĐẠT') ? '=== DAT ===' : '=== HONG ===');
  await c.end();
})().catch(e => { console.error('LỖI', e.message); process.exit(1); });
