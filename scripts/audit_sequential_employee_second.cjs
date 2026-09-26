const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const { parseKtvOptions, ktvServiceName, isLiveKtvSegment } = require('../lib/ktvUtils');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const modalPath = require.resolve('../app/ktv/dashboard/_components/modals');
require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true, exports: Object.fromEntries(['ProcedureModal', 'RoomIssueModal', 'RejectOrderModal', 'TurnQueueTypeDModal', 'OfficeScoreModal'].map(name => [name, () => null])) };
const reminderPath = require.resolve('../app/ktv/dashboard/_components/CheckInReminder');
require.cache[reminderPath] = { id: reminderPath, filename: reminderPath, loaded: true, exports: { CheckInReminder: () => null } };
const { ScreenTimer, WorkingTimeline } = require('../app/ktv/dashboard/_screens/ScreenTimer');
const { ScreenDashboard } = require('../app/ktv/dashboard/_screens/ScreenDashboard');
const { ToastProvider } = require('../components/ui/Toast');

// Read-only audit assertions confirm remaining defects, not intended fixed behavior.
const releaseSource = readFileSync(join(__dirname, '../app/api/ktv/booking/_handlers/handleReleaseKTV.ts'), 'utf8');
const releaseCompiled = ts.transpileModule(releaseSource.slice(releaseSource.indexOf('export async function handleReleaseKTV')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const { ktvMatchesSeg } = require('../lib/ktvUtils');
async function auditRelease(segments, failWrites = false) {
 const writes = [], rpc = [];
 const db = { from(table) { let payload; const query = { select() { return this; }, eq() { return this; }, in() { return this; }, update(value) { payload = value; writes.push({ table, payload }); return this; }, then(resolve, reject) { return Promise.resolve({ data: payload ? null : [{ id: 'item', segments: JSON.stringify(segments) }], error: failWrites ? { message: 'DB failed' } : null }).then(resolve, reject); } }; return query; }, async rpc(name, payload) { rpc.push({ name, payload }); return { error: failWrites ? { message: 'RPC failed' } : null }; } };
 const exportsStub = {};
 new Function('exports', 'ktvMatchesSeg', releaseCompiled)(exportsStub, ktvMatchesSeg);
 const result = await exportsStub.handleReleaseKTV({ supabase: db, technicianCode: 'B', today: '2026-09-26', bookingId: 'booking', body: {} });
 return { writes, rpc, result };
}
async function main() {
 const result = await auditRelease([{ id: 'old', ktvId: 'B', voided: true, actualEndTime: '2026-09-26T03:30:00Z' }, { id: 'new', ktvId: 'B', sequenceSlot: 2 }]);
 const changed = JSON.parse(result.writes.find(w => w.table === 'BookingItems').payload.segments);
 assert.ok(changed.every(s => s.handoverTime));
 assert.ok(result.writes.some(w => w.table === 'KtvAssignments' && w.payload.status === 'COMPLETED'));
 console.log('CONFIRMED release: old voided B + unstarted new B both handed over, current B assignment completed');
 const unstarted = await auditRelease([{ id: 'new', ktvId: 'B', sequenceSlot: 2 }]);
 assert.ok(unstarted.writes.some(w => w.table === 'KtvAssignments' && w.payload.status === 'COMPLETED'));
 console.log('CONFIRMED release: only unstarted B still completes ACTIVE assignment via fallback');
 const failed = await auditRelease([{ id: 'b', ktvId: 'B', actualEndTime: '2026-09-26T03:30:00Z' }], true);
 assert.equal(failed.result, undefined); assert.equal(failed.rpc.length, 1);
 console.log('CONFIRMED release: read/write/RPC error fields ignored; resolves success after failures');
 for (const Screen of [ScreenTimer, ScreenDashboard]) {
  assert.throws(() => renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(Screen, { logic: {
   ktvId: 'B', activeSegmentIndex: 0, timeRemaining: 900, prepTimeRemaining: 0, prepProcedure: [], checklist: [], turnData: {}, pendingHandovers: [], settings: {},
   booking: { id: 'booking', acceptedAt: '2026-09-26T03:00:00Z', assignedItemIds: ['item'], assignedItemId: 'item', status: 'PREPARING', BookingItems: [{ id: 'item', duration: 30, service_name: 'Service', segments: '{}' }] }
  } }))), /filter is not a function/);
 }
 console.log('CONFIRMED real Dashboard/Timer: segments JSON object crashes after successful JSON.parse');
 const timeline=renderToStaticMarkup(React.createElement(WorkingTimeline,{segments:[
  {id:'one',ktvId:'B',actualStartTime:'10:00',startTime:'10:00',endTime:'10:30',duration:30},
  {id:'two',ktvId:'B',actualStartTime:'11:00',startTime:'11:00',endTime:'11:30',duration:30}
 ],activeIndex:1,shouldMerge:false}));
 assert.ok(timeline.includes('10:30'));assert.ok(!timeline.includes('11:30'));
 console.log('CONFIRMED WorkingTimeline: second actual 11:00 displayed as 10:30 from first segment');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
