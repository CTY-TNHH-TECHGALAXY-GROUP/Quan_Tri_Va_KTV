/**
 * Nạp 600 BookingItems MẪU vào DB TEST với segments dạng CHUỖI lấy đúng hình dạng từ production (production: CHỈ ĐỌC).
 * node scripts/qa/seg_seed_test.js <prodEnv> <testEnv> seed|clean
 * Dữ liệu thử: Bookings/BookingItems id bắt đầu 'QA-SEG-'. Nạp/dọn trong transaction replica (không kích trigger).
 */
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../../../');
const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const envOf = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const [prodEnv, testEnv, mode] = process.argv.slice(2);
const T = envOf(testEnv); if (!T.NEXT_PUBLIC_SUPABASE_URL.includes('eknggruuiuadwldacpmb')) throw new Error('DỪNG: testEnv không phải DB TEST');
(async () => {
  const test = new Client({ connectionString: T.DIRECT_URL, ssl: { rejectUnauthorized: false } }); await test.connect();
  if (mode === 'clean') {
    await test.query('BEGIN'); await test.query('SET LOCAL session_replication_role = replica');
    const a = await test.query(`DELETE FROM "BookingItems" WHERE id LIKE 'QA-SEG-%'`); const b = await test.query(`DELETE FROM "Bookings" WHERE id LIKE 'QA-SEG-%'`);
    await test.query(`DELETE FROM "KTVDRecomputeQueue" WHERE booking_id LIKE 'QA-SEG-%'`).catch(() => {});
    await test.query('COMMIT'); console.log(`Dọn: ${a.rowCount} dịch vụ, ${b.rowCount} đơn QA-SEG`); await test.end(); return;
  }
  const P = envOf(prodEnv);
  const prod = new Client({ connectionString: P.DIRECT_URL, ssl: { rejectUnauthorized: false } }); await prod.connect(); await prod.query('SET default_transaction_read_only = on');
  const pick = async (where, n) => (await prod.query(`SELECT status, segments, jsonb_unwrap_string(options) o FROM "BookingItems" WHERE jsonb_typeof(segments)='string' AND ${where} ORDER BY random() LIMIT ${n}`)).rows;
  const rows = [
    ...await pick(`status IN ('DONE','CLEANING','FEEDBACK','CANCELLED','COMPLETED')`, 500),
    ...await pick(`status IN ('NEW','WAITING','PREPARING','READY')`, 21),
    ...await pick(`status IN ('IN_PROGRESS','PAUSED')`, 30),
    ...await pick(`(jsonb_unwrap_string(options)->>'sequentialSlots')='2'`, 49),
  ];
  await prod.end();
  const RUN = Date.now().toString(36).toUpperCase();
  await test.query('BEGIN'); await test.query('SET LOCAL session_replication_role = replica');
  const per = 100; let n = 0;
  for (let b = 0; b * per < rows.length; b++) {
    const bid = `QA-SEG-${RUN}-B${b + 1}`;
    await test.query(`INSERT INTO "Bookings"(id,"billCode","customerName",status,source,"bookingDate","guestCount","totalAmount","createdAt","updatedAt") VALUES($1,$1,'QA seg','DONE','STANDARD_WALK_IN',now(),1,0,now(),now())`, [bid]);
    for (const r of rows.slice(b * per, (b + 1) * per)) {
      const o = r.o || {}; const opts = { displayName: o.displayName || 'QA', dispatchRevision: o.dispatchRevision ?? 0, dispatchHistory: (o.dispatchHistory || []).slice(0, 2), ...(o.sequentialSlots ? { sequentialSlots: o.sequentialSlots } : {}) };
      await test.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",quantity,price,status,segments,"technicianCodes",options) VALUES($1,$2,'NHS0101',1,0,$3,$4::jsonb,'{}'::text[],$5::jsonb)`,
        [`QA-SEG-${RUN}-i${++n}`, bid, r.status, JSON.stringify(r.segments), JSON.stringify(opts)]);
    }
  }
  await test.query('COMMIT');
  const chk = await test.query(`SELECT count(*) n, count(*) FILTER (WHERE jsonb_typeof(segments)='string') s, count(*) FILTER (WHERE status IN ('IN_PROGRESS','PAUSED')) run, count(*) FILTER (WHERE options->>'sequentialSlots'='2') seq FROM "BookingItems" WHERE id LIKE 'QA-SEG-${RUN}%'`);
  console.log('Đã nạp:', JSON.stringify(chk.rows[0]), 'RUN', RUN); await test.end();
})().catch(e => { console.error('LỖI', e.message); process.exit(1); });
