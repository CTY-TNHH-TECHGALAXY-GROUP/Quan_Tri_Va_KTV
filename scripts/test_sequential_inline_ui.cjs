const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
// Load the private card for rendering without adding a production export.
const filename = join(__dirname, '../app/reception/dispatch/_components/QuickDispatchTable.tsx');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8') + '\nexport { ServiceGroupCard };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(dirname(filename));
loaded._compile(compiled, filename);
const { ServiceGroupCard } = loaded.exports;
const jsxRuntime = require('react/jsx-runtime');
let actions = [], lastUpdate, lastHandoff;

function render({ minutes = 60, sequential = false, b = false, status = 'NEW', finishedAfterA = false } = {}) {
  actions = []; lastUpdate = undefined; lastHandoff = undefined;
  const ids = b ? ['A', 'B'] : ['A'];
  const segments = ids.map((ktvId, idx) => ({ id: `segment-${ktvId}`, roomId: 'R', bedId: 'X',
    startTime: idx ? '10:30' : '10:00', endTime: idx ? '11:00' : minutes === 30 ? '10:30' : '11:00',
    duration: idx ? 30 : minutes, sequenceSlot: sequential ? idx + 1 : undefined }));
  const item = { id: 'item', serviceId: 'NHS0001', serviceName: 'Test', duration: 60, status,
    options: sequential ? { sequentialSlots: 2, finishedAfterA } : {},
    staffList: ids.map((ktvId, idx) => ({ id: `row-${ktvId}`, ktvId, ktvName: ktvId, segments: [segments[idx]], noteForKtv: '' })) };
  const state = { selectedKtvIds: ids, selectedRoomIds: ids.map(() => 'R'), ktvBedIds: ids.map(() => 'X'),
    ktvDurations: segments.map(s => s.duration), ktvStartTimes: segments.map(s => s.startTime), ktvEndTimes: segments.map(s => s.endTime),
    ktvNotes: [], displayName: 'Test', duration: 60, workMode: sequential ? 'sequential' : 'parallel', confirmedSequential: sequential };
  const originalJsx = jsxRuntime.jsx, originalJsxs = jsxRuntime.jsxs;
  const capture = original => (...args) => {
    const element = original(...args);
    if (typeof element.type === 'string' && (element.props.onClick || element.props.onChange)) actions.push(element);
    return element;
  };
  jsxRuntime.jsx = capture(originalJsx); jsxRuntime.jsxs = capture(originalJsxs);
  let html;
  try { html = renderToStaticMarkup(React.createElement(ServiceGroupCard, {
    serviceName: 'Test', count: 1, duration: 60, state, groupItems: [item], allServices: [item],
    availableTurns: [], staffs: [], allSelectedKtvIds: ids, rooms: [{ id: 'R', name: 'Phòng R' }], beds: [{ id: 'X', roomId: 'R' }],
    busyBedIds: [], onUpdate: patch => { lastUpdate = patch; }, onPrint() {}, onEnableSequential() {},
    onLiveHandoff: (...args) => { lastHandoff = args; }, getLatestEndTime: () => '',
  })); } finally { jsxRuntime.jsx = originalJsx; jsxRuntime.jsxs = originalJsxs; }
  return html;
}

const full = render();
assert.ok(full.includes('+ Nối tiếp'));
assert.ok(!full.includes('Song song (Cùng làm)'));
assert.ok(!full.includes('Nối tiếp (Xoay tua)'));
console.log('PASS 1/5: Một A không có selector cách làm');
const short = render({ minutes: 30 });
assert.ok(short.includes('Còn 30 phút · + Nối tiếp'));
assert.ok(!short.includes('B · Chưa chọn nhân viên'));
actions.find(e => e.props.children === 'Còn 30 phút · + Nối tiếp').props.onClick();
assert.deepEqual(lastUpdate, { workMode: 'sequential', confirmedSequential: true });
console.log('PASS 2/5: A 30/60 chỉ gợi ý, chưa mở B');
const emptyB = render({ minutes: 30, sequential: true });
assert.ok(emptyB.includes('B · Chưa chọn nhân viên'));
assert.ok(emptyB.includes('Chọn nhân viên B (có thể chọn sau)'));
assert.ok(emptyB.includes('10:30 · 30 phút còn lại'));
actions.find(e => e.props['aria-label'] === 'Chọn nhân viên B').props.onChange({ target: { value: 'B' } });
assert.deepEqual(lastUpdate.selectedKtvIds, ['A', 'B']);
assert.deepEqual(lastUpdate.ktvDurations, [30, 30]);
assert.deepEqual(lastUpdate.ktvStartTimes, ['10:00', '10:30']);
assert.deepEqual(lastUpdate.ktvBedIds, ['X', 'X']);
console.log('PASS 3/5: Nháp nối tiếp có hàng B trống dưới A');
const assignedB = render({ minutes: 30, sequential: true, b: true });
assert.ok(!assignedB.includes('B · Chưa chọn nhân viên'));
assert.ok(!assignedB.includes('Sửa B'));
assert.ok(assignedB.includes('value="30"'));
console.log('PASS 4/5: Chọn B trong nháp tạo hàng thật, sửa trực tiếp được');
const liveEmptyB = render({ minutes: 30, sequential: true, status: 'PREPARING' });
assert.ok(liveEmptyB.includes('+ Chọn nhân viên B'));
assert.ok(!liveEmptyB.includes('Bỏ nối tiếp'));
actions.find(e => e.props.children === '+ Chọn nhân viên B').props.onClick();
assert.deepEqual(lastHandoff, ['item', 'A', '']);
const ended = render({ minutes: 30, sequential: true, status: 'CLEANING', finishedAfterA: true });
assert.ok(!ended.includes('B · Chưa chọn nhân viên'));
assert.ok(!ended.includes('+ Nối tiếp'));
console.log('PASS 5/5: Sau gửi chọn B qua thao tác riêng; kết thúc sau A không còn thêm B');

const kanbanFilename = join(__dirname, '../app/reception/dispatch/_components/KanbanBoard.tsx');
const kanbanModule = new Module(kanbanFilename, module);
kanbanModule.filename = kanbanFilename;
kanbanModule.paths = Module._nodeModulePaths(dirname(kanbanFilename));
kanbanModule._compile(ts.transpileModule(readFileSync(kanbanFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, kanbanFilename);

function renderKanban({ status = 'PREPARING', assignedB = false, voidedB = false, finishedAfterA = false } = {}) {
  const a = { id: 'a', ktvId: 'A', sequenceSlot: '1', startTime: '10:00', endTime: '10:30', duration: 30, roomId: 'R', bedId: 'X',
    ...(status === 'IN_PROGRESS' ? { actualStartTime: '2026-09-26T03:00:00Z', actualEndTime: '2026-09-26T03:30:00Z' } : {}) };
  const b = { id: 'b', ktvId: 'B', sequenceSlot: '2', startTime: '10:30', endTime: '11:00', duration: 30, roomId: 'R', bedId: 'X', voided: voidedB };
  const segments = assignedB || voidedB ? [a, b] : [a];
  const service = { id: 'item', serviceName: 'Test', duration: 60, status, selectedRoomId: 'R',
    options: { sequentialSlots: 2, finishedAfterA }, staffList: segments.map(s => ({ id: s.id, ktvId: s.ktvId, ktvName: s.ktvId, segments: [s], noteForKtv: '' })) };
  const order = { id: 'child-booking', parentBookingId: 'parent-booking', billCode: 'LOCAL-001', customerName: 'Khách test',
    dispatchStatus: status, rawStatus: status, time: '10:00', services: [service], hasAssignedKtv: true };
  const originalJsx = jsxRuntime.jsx, originalJsxs = jsxRuntime.jsxs;
  let button, detail, handoff;
  const capture = original => (...args) => {
    const element = original(...args);
    if (element.type === 'button' && element.props.title === 'Mở điều phối để gán nhân viên B') button = element;
    return element;
  };
  jsxRuntime.jsx = capture(originalJsx); jsxRuntime.jsxs = capture(originalJsxs);
  let html;
  try { html = renderToStaticMarkup(React.createElement(kanbanModule.exports.KanbanBoard, {
    orders: [order], staffs: [], onUpdateStatus() {}, onOpenDetail: (...args) => { detail = args; },
    onAssignSequentialB: (...args) => { handoff = args; },
  })); } finally { jsxRuntime.jsx = originalJsx; jsxRuntime.jsxs = originalJsxs; }
  return { html, button, click: () => {
    let stopped = false;
    button.props.onClick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(detail[0], 'parent-booking');
    assert.ok(detail[1]);
    assert.deepEqual(handoff, ['child-booking', 'item', 'A']);
  } };
}
for (const config of [{}, { status: 'IN_PROGRESS' }, { voidedB: true }]) {
  const card = renderKanban(config);
  assert.ok(card.html.includes('Chưa gán B · + Điều phối'));
  assert.ok(card.button.props.className.includes('text-rose-600'));
  card.click();
}
for (const config of [{ assignedB: true }, { status: 'CLEANING', finishedAfterA: true }, { status: 'CANCELLED' }]) {
  assert.equal(renderKanban(config).button, undefined);
}
console.log('PASS Kanban: Chưa gán B mở đúng điều phối và gán B; không hiện khi B đã gán/ca đã đóng');
