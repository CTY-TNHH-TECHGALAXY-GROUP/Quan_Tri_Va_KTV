const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
// Run the actual action body with read-only DB/auth stubs; SQL locking is covered separately.
const source = readFileSync(join(__dirname, '../app/reception/dispatch/actions.ts'), 'utf8');
const body = source.slice(source.indexOf('export async function editDispatchActualTimes('), source.indexOf('/** Ghi ý định nối tiếp'));
const compiled = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const before = [{ id: 'a', ktvId: 'A', startTime: '10:00', duration: 30, actualStartTime: '2026-09-26T03:00:00Z' },
  { id: 'b', ktvId: 'B', startTime: '10:45', duration: 30 }];
let stored = { segments: before, options: { dispatchRevision: 99 } }, writes = [];
const db = { from(table) { assert.equal(table, 'BookingItems'); return {
  select() { return this; }, eq() { return this; }, async single() { return { data: structuredClone(stored) }; }
}; } };
const exportsStub = {};
new Function('requirePermission', 'getSupabaseAdmin', 'applyDispatchEdit', 'exports', compiled)(
  async permission => assert.equal(permission, 'dispatch_board'), () => db,
  async (_db, booking, action, payload) => { writes.push({ booking, action, payload }); return { data: { success: true } }; }, exportsStub);
const edit = (times, revision = 5) => exportsStub.editDispatchActualTimes('booking', 'item', revision, times);
async function main() {
  assert.equal((await edit([{ segmentId: 'a', actualStartTime: '2026-09-26T10:01:00+07:00', actualEndTime: null }])).success, true);
  assert.equal(writes[0].payload.itemUpdates[0].options.dispatchRevision, 5); // Never replace the form's version with DB revision 99.
  assert.equal(writes[0].action, 'EDIT_ACTUAL_TIME');
  assert.equal(writes[0].payload.itemUpdates[0].segments[0].actualStartTime, '2026-09-26T03:01:00.000Z');
  assert.deepEqual(writes[0].payload.itemUpdates[0].segments[1], before[1]);
  assert.deepEqual(stored.segments, before);
  for (const times of [
    [{ segmentId: 'a', actualStartTime: '2026-09-26T10:01:00', actualEndTime: null }],
    [{ segmentId: 'a', actualStartTime: null, actualEndTime: null }],
    [{ segmentId: 'a', actualStartTime: '2026-09-26T03:00:00Z', actualEndTime: '2026-09-26T02:59:00Z' }],
    [{ segmentId: 'unknown', actualStartTime: null, actualEndTime: null }],
  ]) assert.equal((await edit(times)).success, false);
  assert.equal(writes.length, 1);
  stored = { segments: [{ ...before[0], voided: true }], options: { dispatchRevision: 5 } };
  assert.equal((await edit([{ segmentId: 'a', actualStartTime: '2026-09-26T03:02:00Z', actualEndTime: null }])).success, false);
  assert.equal(writes.length, 1);
  console.log('PASS actual-time action: ISO validation, time order, no erasing/reviving, own segment, form revision preserved');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
