/**
 * Áp migration chuẩn hoá segments lên một DB, rồi ghi thử TRONG TRANSACTION + ROLLBACK (không để lại gì,
 * không phát realtime / thông báo). node scripts/qa/seg_apply_prod.js <envFile> <migration.sql>
 */
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../../../');
const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const envOf = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const [envFile, sqlFile] = process.argv.slice(2); const E = envOf(envFile);
(async () => {
  const c = new Client({ connectionString: E.DIRECT_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  console.log('DB:', E.NEXT_PUBLIC_SUPABASE_URL.slice(8, 14));
  await c.query(fs.readFileSync(sqlFile, 'utf8'));
  const trg = await c.query(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='"BookingItems"'::regclass AND NOT tgisinternal ORDER BY tgname`);
  console.log('Trigger trên BookingItems:', trg.rows.map(r => `${r.tgname}[${r.tgenabled}]`).join(', '));
  const id = 'QA-ROLLBACK-' + Date.now().toString(36); const res = [];
  await c.query('BEGIN');
  try {
    await c.query(`INSERT INTO "Bookings"(id,"billCode","customerName",status,source,"bookingDate","guestCount","totalAmount","createdAt","updatedAt") VALUES($1,$1,'QA rollback','NEW','STANDARD_WALK_IN',now(),1,0,now(),now())`, [id]);
    const svc = (await c.query(`SELECT id FROM "Services" LIMIT 1`)).rows[0].id;
    const seg = [{ id: 's1', ktvId: 'X', startTime: '20:00', endTime: '21:00', duration: 60 }];
    const cases = [['chuỗi JSON (như app)', JSON.stringify(JSON.stringify(seg)), 'array'], ["chuỗi '[]' (phát sinh)", JSON.stringify('[]'), 'array'], ['mảng', JSON.stringify(seg), 'array'], ['chuỗi hỏng', JSON.stringify('abc{'), 'string']];
    let k = 0;
    for (const [label, val, expect] of cases) {
      const iid = `${id}-${++k}`;
      await c.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",quantity,price,status,segments,"technicianCodes",options) VALUES($1,$2,$3,1,0,'NEW',$4::jsonb,'{}'::text[],'{}'::jsonb)`, [iid, id, svc, val]);
      const t = (await c.query(`SELECT jsonb_typeof(segments) t FROM "BookingItems" WHERE id=$1`, [iid])).rows[0].t;
      res.push({ ca: label, luu_thanh: t, ok: t === expect ? 'ĐẠT' : 'HỎNG' });
    }
    await c.query(`UPDATE "BookingItems" SET segments=$2::jsonb WHERE id=$1`, [`${id}-3`, JSON.stringify(JSON.stringify(seg))]);
    const t = (await c.query(`SELECT jsonb_typeof(segments) t FROM "BookingItems" WHERE id=$1`, [`${id}-3`])).rows[0].t;
    res.push({ ca: 'UPDATE ghi chuỗi', luu_thanh: t, ok: t === 'array' ? 'ĐẠT' : 'HỎNG' });
  } finally { await c.query('ROLLBACK'); }
  const left = (await c.query(`SELECT count(*) n FROM "Bookings" WHERE id LIKE 'QA-ROLLBACK-%'`)).rows[0].n;
  console.table(res); console.log('Dữ liệu thử còn lại sau ROLLBACK:', left);
  console.log(res.every(r => r.ok === 'ĐẠT') && Number(left) === 0 ? '=== DAT ===' : '=== HONG ===');
  await c.end();
})().catch(e => { console.error('LỖI', e.message); process.exit(1); });
