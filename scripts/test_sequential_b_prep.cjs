// Mock test: chuẩn bị gán B cho KTV ngoài (lib/dispatch/sequential-b-prep.ts). Chạy: node scripts/test_sequential_b_prep.cjs
const path = require('path');
const mod = require(path.join(__dirname, '..', 'lib/dispatch/sequential-b-prep.ts'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✅', m); } else { fail++; console.log('❌', m); } };

function mockDb(tables) {
  const log = [];
  const api = { log, from(table) {
    const st = { table, filters: [], order: null, limit: null, op: 'select', payload: null };
    const rows = () => (tables[table] || []).filter(r => st.filters.every(f => f(r)));
    const b = {
      select() { return b; },
      eq(k, v) { st.filters.push(r => String(r[k]) === String(v)); return b; },
      neq(k, v) { st.filters.push(r => String(r[k]) !== String(v)); return b; },
      order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b; },
      limit(n) { st.limit = n; return b; },
      async maybeSingle() {
        let r = rows(); if (st.order) r = [...r].sort((a, c) => (a[st.order.k] > c[st.order.k] ? 1 : -1) * (st.order.asc ? 1 : -1));
        return { data: r[0] || null, error: null };
      },
      async upsert(row, opts) { log.push({ table, op: 'upsert', row, opts }); (tables[table] ||= []).push(row); return { error: null }; },
    };
    return b;
  } };
  return api;
}

(async () => {
  // 1. KTV nhà có sổ tua → không chèn
  let db = mockDb({ KtvAssignments: [{ booking_id: 'BK1', booking_item_id: 'IT1', status: 'ACTIVE', business_date: '2026-10-05', created_at: 1 }],
    TurnQueue: [{ id: 't1', employee_id: 'NH01', date: '2026-10-05', queue_position: 3, check_in_order: 5 }] });
  let r = await mod.ensureTurnQueueRowForSequentialB(db, { bookingId: 'BK1', itemId: 'IT1', ktvId: 'NH01' });
  ok(r.ok && !r.inserted && db.log.length === 0, 'KTV có sổ tua → không chèn');

  // 2. KTV ngoài chưa có sổ tua → chèn waiting cuối hàng (max+1 cả hai cột)
  db = mockDb({ KtvAssignments: [{ booking_id: 'BK1', booking_item_id: 'IT1', status: 'ACTIVE', business_date: '2026-10-05', created_at: 1 }],
    TurnQueue: [{ id: 't1', employee_id: 'NH01', date: '2026-10-05', queue_position: 3, check_in_order: 7 }, { id: 't2', employee_id: 'NH02', date: '2026-10-04', queue_position: 9, check_in_order: 9 }] });
  r = await mod.ensureTurnQueueRowForSequentialB(db, { bookingId: 'BK1', itemId: 'IT1', ktvId: 'EXT_ABC123' });
  const ins = db.log[0];
  ok(r.ok && r.inserted && ins && ins.row.status === 'waiting' && ins.row.queue_position === 4 && ins.row.check_in_order === 8 && ins.row.date === '2026-10-05'
    && ins.opts.onConflict === 'employee_id,date' && ins.opts.ignoreDuplicates === true, 'KTV ngoài → chèn waiting, vị trí 4 / điểm danh 8, đúng ngày A, ON CONFLICT bỏ qua');

  // 3. Ca đêm: A business_date hôm trước dù giờ hiện tại đã sang ngày mới; phân công CANCELLED bị bỏ qua
  db = mockDb({ KtvAssignments: [
      { booking_id: 'BK2', booking_item_id: 'IT2', status: 'CANCELLED', business_date: '2026-10-06', created_at: 0 },
      { booking_id: 'BK2', booking_item_id: 'IT2', status: 'ACTIVE', business_date: '2026-10-05', created_at: 1 }], TurnQueue: [] });
  r = await mod.ensureTurnQueueRowForSequentialB(db, { bookingId: 'BK2', itemId: 'IT2', ktvId: 'C_XYZ' });
  ok(r.ok && r.inserted && r.businessDate === '2026-10-05' && db.log[0].row.queue_position === 1, 'Ca đêm: dùng business_date của A còn hiệu lực, hàng rỗng → vị trí 1');

  // 4. Không thấy A → không chèn, để RPC báo lỗi
  db = mockDb({ KtvAssignments: [], TurnQueue: [] });
  r = await mod.ensureTurnQueueRowForSequentialB(db, { bookingId: 'BK3', itemId: 'IT3', ktvId: 'EXT_1' });
  ok(r.ok && !r.inserted && r.businessDate === null && db.log.length === 0, 'Không có phân công A → không chèn gì');

  // 5. renameMetadataKey đổi khoá NEW_EXT → EXT_
  const meta = mod.renameMetadataKey({ serviceNamesForKtvs: { 'NEW_EXT:LISA': 'Foot 60', NH01: 'Body' }, notesForKtvs: { 'NEW_EXT:LISA': 'nhẹ' } }, 'NEW_EXT:LISA', 'EXT_Q1W2E3');
  ok(meta.serviceNamesForKtvs.EXT_Q1W2E3 === 'Foot 60' && !('NEW_EXT:LISA' in meta.serviceNamesForKtvs) && meta.serviceNamesForKtvs.NH01 === 'Body' && meta.notesForKtvs.EXT_Q1W2E3 === 'nhẹ', 'renameMetadataKey đổi đúng khoá, giữ khoá khác');
  ok(mod.renameMetadataKey(undefined, 'a', 'b') === undefined, 'renameMetadataKey chịu metadata undefined');

  console.log(`\n${pass} pass / ${fail} fail`); process.exit(fail ? 1 : 0);
})();
