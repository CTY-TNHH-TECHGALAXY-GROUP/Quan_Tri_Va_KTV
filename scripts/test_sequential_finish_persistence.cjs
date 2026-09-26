const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const exports = {};
  cache[file] = exports;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', js)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, opts) => ({ body, status: opts.status }) } };
    if (name === '../_shared/utils') return {};
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    throw new Error('Unexpected dependency: ' + name);
  }, exports);
  return exports;
}
const { handleFinishService } = load('app/api/ktv/booking/_handlers/handleFinishService.ts');
const start = '2026-09-26T03:00:00.000Z';
const item = (id, ktv = 'A') => ({ id, bookingId: 'booking', status: 'IN_PROGRESS', options: {}, serviceId: 'svc', handover_status: null, itemRating: null, guest_id: null, segments: [{ id: id + '-seg', ktvId: ktv, roomId: 'room', duration: 30, actualStartTime: start }] });
function database(seed, failure = '') {
  const rows = structuredClone(seed);
  let reads = 0, writes = 0;
  const db = { rpc: async (name, args) => {
    assert.equal(name, 'ktv_finish_service_atomic');
    if (failure === 'network') throw new Error('offline');
    if (failure === 'missing-rpc') return { error: { code: 'PGRST202', message: 'Could not find ktv_finish_service_atomic in schema cache' } };
    if (failure.startsWith('write-') || failure === 'rpc' || failure === 'missing-rpc') return { error: { message: failure } };
    for (const patch of args.p_updates) Object.assign(rows.find(row => row.id === patch.id), structuredClone(patch));
    return { data: { success: true, booking: { id: 'booking', status: args.p_booking_status } } };
  }, from(table) {
    let operation, payload, filterKey, filterValue;
    const query = {
      select() { operation = 'select'; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      eq(key, value) { filterKey = key; filterValue = value; return this; },
      in(key, value) { filterKey = key; filterValue = value; return this; },
      single() { return this; },
      then(resolve, reject) {
        try {
          if (operation === 'select') {
            reads++;
            if (failure === `read-${reads}`) return Promise.resolve({ data: null, error: { message: failure } }).then(resolve, reject);
            if (table === 'Bookings') return Promise.resolve({ data: { id: 'booking', status: 'IN_PROGRESS', rating: null, BookingGuests: [] } }).then(resolve, reject);
            let selected = rows.filter(row => filterKey === 'id' ? (Array.isArray(filterValue) ? filterValue.includes(row.id) : row.id === filterValue) : row.bookingId === filterValue);
            return Promise.resolve({ data: structuredClone(selected) }).then(resolve, reject);
          }
          writes++;
          if (failure === `write-${writes}`) return Promise.resolve({ error: { message: failure } }).then(resolve, reject);
          if (failure === 'network') return Promise.reject(new Error('offline')).then(resolve, reject);
          Object.assign(rows.find(row => row.id === filterValue), structuredClone(payload));
          return Promise.resolve({ error: null }).then(resolve, reject);
        } catch (err) { return Promise.reject(err).then(resolve, reject); }
      }
    };
    return query;
  } };
  return { db, rows, get writes() { return writes; } };
}
const run = (state, ktv = 'A', ids = state.rows.map(row => row.id)) => handleFinishService({ supabase: state.db, bookingId: 'booking', technicianCode: ktv, status: 'CLEANING', allItemIdsForThisKTV: ids, body: {} });
const segments = row => typeof row.segments === 'string' ? JSON.parse(row.segments) : row.segments;
async function main() {
  for (const failure of ['read-1', 'read-2', 'read-3', 'rpc', 'missing-rpc']) {
    const state = database([item('one')], failure);
    const result = await run(state);
    assert.equal(result.earlyResponse.status, ['rpc', 'missing-rpc'].includes(failure) ? 409 : 500, failure);
    assert.equal(state.writes, 0);
    assert.equal(result.earlyResponse.body.success, false);
    assert.deepEqual(result.bookingUpdatePayload, {});
    if (failure.startsWith('read-') && ['read-1', 'read-2'].includes(failure)) assert.equal(state.writes, 0);
  }
  console.log('PASS FINISH errors: booking/items/services reads and atomic RPC cannot report success');

  const before = [item('one'), item('two')];
  const batchFailure = database(before, 'write-2');
  assert.equal((await run(batchFailure)).earlyResponse.status, 409);
  assert.deepEqual(batchFailure.rows, before);
  const retry = database(batchFailure.rows);
  assert.equal((await run(retry)).bookingPersisted, true);
  const saved = structuredClone(retry.rows);
  const again = database(saved);
  assert.equal((await run(again)).bookingPersisted, true);
  assert.deepEqual(again.rows.map(row => segments(row)[0].actualEndTime), saved.map(row => segments(row)[0].actualEndTime));
  console.log('PASS FINISH atomic RPC failure: no local per-item writes; retry preserves committed stamps');

  const parent = item('parent');
  const child = { ...item('child'), options: JSON.stringify(JSON.stringify({ mergedIntoId: 'parent' })) };
  const merged = database([parent, child]);
  assert.equal((await run(merged, 'A', ['parent'])).bookingPersisted, true);
  assert.equal(merged.rows[0].status, 'CLEANING');
  assert.equal(merged.rows[1].status, 'CLEANING');
  console.log('PASS FINISH merged-child status included in same RPC batch');

  const sequential = item('seq');
  sequential.options = { sequentialSlots: 2 };
  sequential.segments[0].sequenceSlot = 1;
  const oldB = { id: 'old-b', ktvId: 'B', sequenceSlot: 2, voided: true, actualStartTime: start, duration: 30 };
  sequential.segments.push(oldB, { id: 'new-b', ktvId: 'B', sequenceSlot: 2, duration: 30 });
  const a = database([sequential]);
  assert.equal((await run(a)).bookingData.status, 'IN_PROGRESS');
  assert.ok(segments(a.rows[0])[0].actualEndTime);
  assert.deepEqual(segments(a.rows[0])[1], oldB);
  assert.equal(segments(a.rows[0])[2].actualEndTime, undefined);
  const bSeed = structuredClone(a.rows);
  bSeed[0].segments = segments(bSeed[0]);
  bSeed[0].segments[2].actualStartTime = start;
  const b = database(bSeed);
  assert.equal((await run(b, 'B')).bookingData.status, 'CLEANING');
  assert.deepEqual(segments(b.rows[0])[1], oldB);
  assert.equal(segments(b.rows[0])[0].actualEndTime, segments(a.rows[0])[0].actualEndTime);
  assert.ok(segments(b.rows[0])[2].actualEndTime);
  console.log('PASS FINISH sequential: A waits B, latest B completes, cancelled B and A stamps untouched');

  const noB = { ...item('only-a'), options: { sequentialSlots: 2, finishedAfterA: true }, segments: [{ ...item('only-a').segments[0], sequenceSlot: 1 }] };
  assert.equal((await run(database([noB]))).bookingData.status, 'CLEANING');
  const replaced = item('replaced');
  replaced.segments[0].voided = true;
  const stale = database([replaced]);
  assert.equal((await run(stale)).earlyResponse.status, 409);
  assert.equal(stale.writes, 0);
  await assert.rejects(() => run(database([item('offline')], 'network')), /offline/);
  console.log('PASS FINISH after A + swapped employee guard + network failure rejects');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
