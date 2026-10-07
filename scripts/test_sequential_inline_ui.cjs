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
assert.match(readFileSync(filename, 'utf8').trimStart(), /^['"]use client['"];?/,
  'Next.js client directive must precede imports');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8') + '\nexport { ServiceGroupCard };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(dirname(filename));
loaded._compile(compiled, filename);
const { ServiceGroupCard } = loaded.exports;
assert.ok(!readFileSync(join(__dirname, '../app/reception/dispatch/page.tsx'), 'utf8').includes('splitBookingItem('),
  'Chọn KTV trong form không được tách booking trước Lưu/Điều phối');
const jsxRuntime = require('react/jsx-runtime');
let lastDispatch;
let actions = [], lastUpdate, lastHandoff;

function render({ minutes = 60, sequential = false, b = false, status = 'NEW', finishedAfterA = false, startedA = false, startedB = false, bStart = '10:30', names = [], pending = false, turns = [] } = {}) {
  actions = []; lastUpdate = undefined; lastHandoff = undefined;
  const ids = b ? ['A', 'B'] : ['A'];
  const segments = ids.map((ktvId, idx) => ({ id: `segment-${ktvId}`, roomId: 'R', bedId: 'X',
    startTime: idx ? bStart : '10:00', endTime: idx ? '11:00' : minutes === 30 ? '10:30' : '11:00',
    duration: idx ? 30 : minutes, sequenceSlot: sequential ? idx + 1 : undefined,
    ...(idx === 0 && startedA ? { actualStartTime: '2026-09-26T03:00:00Z' } : {}),
    ...(idx === 1 && startedB ? { actualStartTime: '2026-09-26T03:30:00Z' } : {}) }));
  const item = { id: 'item', serviceId: 'NHS0001', serviceName: 'Test', duration: 60, status,
    options: sequential ? { sequentialSlots: 2, finishedAfterA } : {},
    staffList: ids.map((ktvId, idx) => ({ id: `row-${ktvId}`, ktvId, ktvName: ktvId, segments: [segments[idx]], noteForKtv: '' })) };
  const state = { selectedKtvIds: ids, selectedRoomIds: ids.map(() => 'R'), ktvBedIds: ids.map(() => 'X'),
    ktvDurations: segments.map(s => s.duration), ktvStartTimes: segments.map(s => s.startTime), ktvEndTimes: segments.map(s => s.endTime),
    ktvNotes: [], ktvServiceNames: names, displayName: 'Test', duration: 60, workMode: sequential ? 'sequential' : 'parallel', confirmedSequential: sequential };
  const originalJsx = jsxRuntime.jsx, originalJsxs = jsxRuntime.jsxs, originalUseState = React.useState;
  let stateCalls = 0;
  if (pending) React.useState = initial => {
    const value = originalUseState(initial);
    return ++stateCalls === 7 ? [true, value[1]] : value;
  };
  const capture = original => (...args) => {
    const element = original(...args);
    if (typeof element.type === 'string' && (element.props.onClick || element.props.onChange || element.props.onDrop)) actions.push(element);
    return element;
  };
  jsxRuntime.jsx = capture(originalJsx); jsxRuntime.jsxs = capture(originalJsxs);
  let html;
  try { html = renderToStaticMarkup(React.createElement(ServiceGroupCard, {
    serviceName: 'Test', count: 1, duration: 60, state, groupItems: [item], allServices: [item],
    availableTurns: turns, staffs: [], allSelectedKtvIds: ids, rooms: [{ id: 'R', name: 'Phòng R' }], beds: [{ id: 'X', roomId: 'R' }],
    busyBedIds: [], onUpdate: patch => { lastUpdate = patch; }, onPrint() {}, onEnableSequential() {},
    onLiveHandoff: (...args) => { lastHandoff = args; }, onSaveRow: async (idx,pair) => { lastDispatch = {idx,pair}; return true; }, getLatestEndTime: () => '',
  })); } finally { jsxRuntime.jsx = originalJsx; jsxRuntime.jsxs = originalJsxs; React.useState = originalUseState; }
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
render({ minutes: 30, status: 'PREPARING' });
actions.find(e => e.props.children === 'Còn 30 phút · + Nối tiếp').props.onClick();
assert.deepEqual(lastUpdate, { workMode: 'sequential', confirmedSequential: true });
console.log('PASS live + Nối tiếp stays in the local form until Save A');
const livePending = render({ minutes: 30, sequential: true, status: 'IN_PROGRESS', pending: true });
assert.ok(livePending.includes('Chọn nhân viên B (có thể chọn sau)'));
actions.find(e => e.props['aria-label'] === 'Chọn nhân viên B').props.onChange({ target: { value: 'B' } });
assert.deepEqual(lastUpdate.selectedKtvIds, ['A', 'B']);
assert.equal(lastHandoff, undefined);
render({ minutes: 30, sequential: true, b: true, status: 'IN_PROGRESS', pending: true });
const pairSaves = actions.filter(e => e.props['aria-label']?.endsWith(' (A và B)'));
assert.equal(pairSaves.length, 2);
for (const [idx, button] of pairSaves.entries()) {
  button.props.onClick();
  assert.deepEqual(lastDispatch, {idx,pair:true});
}
console.log('PASS live A/B can be staged together without a save or handoff RPC');
render({ minutes: 30, sequential: true, status: 'IN_PROGRESS', startedA: true });
const runningDuration = actions.find(e => e.props['aria-label'] === 'Thời lượng nhân viên A');
assert.equal(runningDuration.props.disabled, false);
assert.equal(actions.find(e => e.props['aria-label'] === 'Giờ bắt đầu KTV 1').props.disabled, true);
runningDuration.props.onChange({target:{value:'47'}});
assert.equal(lastUpdate.ktvDurations[0],47);
assert.equal(lastUpdate.ktvEndTimes[0],'10:47');
render({ minutes: 30, sequential: true, b: true, status: 'IN_PROGRESS', startedA: true, startedB: true });
assert.equal(actions.find(e => e.props['aria-label'] === 'Thời lượng nhân viên A').props.disabled, true);
console.log('PASS running A: only assigned minutes can be edited while B has not started');
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
assert.ok(liveEmptyB.includes('Chọn nhân viên B (có thể chọn sau)'));
assert.ok(!liveEmptyB.includes('Bỏ nối tiếp'));
actions.find(e => e.props['aria-label'] === 'Chọn nhân viên B').props.onChange({target:{value:'B'}});
assert.deepEqual(lastUpdate.selectedKtvIds,['A','B']);
assert.equal(lastHandoff,undefined);
const ended = render({ minutes: 30, sequential: true, status: 'CLEANING', finishedAfterA: true });
assert.ok(!ended.includes('B · Chưa chọn nhân viên'));
assert.ok(!ended.includes('+ Nối tiếp'));
console.log('PASS 5/5: Sau gửi chọn B qua thao tác riêng; kết thúc sau A không còn thêm B');

render({ minutes: 30, sequential: true, b: true });
actions.find(e => e.props['aria-label'] === 'Bỏ nhân viên hàng 2 khỏi bản nháp').props.onClick();
assert.deepEqual(lastUpdate.selectedKtvIds, ['A']);
assert.deepEqual(lastUpdate.ktvStartTimes, ['10:00']);
assert.equal(actions.find(e => e.props['aria-label'] === 'Bỏ nhân viên hàng 1 khỏi bản nháp').props.disabled,false);
render({ minutes: 30, sequential: true, b: true });
actions.find(e => e.props['aria-label'] === 'Giờ bắt đầu B').props.onChange({ target: { value: '10:45' } });
assert.deepEqual(lastUpdate.ktvStartTimes, ['10:00', '10:45']);
assert.deepEqual(lastUpdate.ktvEndTimes, ['10:30', '11:15']);
render({ minutes: 30, sequential: true, b: true, status: 'PREPARING' });
const replaceB = actions.find(e => e.props['aria-label'] === 'Nhân viên B');
assert.ok(replaceB);
replaceB.props.onChange({ target: { value: 'C' } });
assert.deepEqual(lastUpdate.selectedKtvIds, ['A','C']);
assert.equal(lastHandoff, undefined);
assert.equal(actions.find(e => e.props['aria-label'] === 'Bỏ nhân viên hàng 2 khỏi bản nháp').props.disabled,false);
assert.equal(actions.find(e => e.props['aria-label'] === 'Thời lượng nhân viên B').props.disabled,false);
const liveBTime = actions.find(e => e.props['aria-label'] === 'Giờ bắt đầu B');
assert.equal(liveBTime.props.disabled, false);
assert.equal(actions.find(e => e.props['aria-label'] === 'Giờ bắt đầu KTV 1').props.disabled, false);
liveBTime.props.onChange({ target: { value: '10:45' } });
assert.deepEqual(lastUpdate.ktvStartTimes, ['10:00','10:45']);
assert.deepEqual(lastUpdate.ktvEndTimes, ['10:30','11:15']);
const saveBTime = actions.filter(e => e.props['aria-label']?.endsWith(' (A và B)'))[1];
assert.equal(saveBTime.props.disabled, false); saveBTime.props.onClick();
assert.deepEqual(lastDispatch,{idx:1,pair:true});
assert.equal(actions.filter(e => e.props['aria-label']?.endsWith(' (A và B)')).length,2);
render({ minutes: 30, sequential: true, b: true, status: 'IN_PROGRESS', startedB: true });
assert.ok(!actions.some(e => e.props['aria-label'] === 'Đổi nhân viên B'));
assert.equal(actions.find(e => e.props['aria-label'] === 'Giờ bắt đầu B').props.disabled, true);
assert.ok(actions.some(e => e.props['aria-label']?.endsWith(' (A và B)')));
console.log('PASS giờ B: icon lưu từng nhân viên; khóa giờ khi B đã bắt đầu');

const kanbanFilename = join(__dirname, '../app/reception/dispatch/_components/KanbanBoard.tsx');
const kanbanModule = new Module(kanbanFilename, module);
kanbanModule.filename = kanbanFilename;
kanbanModule.paths = Module._nodeModulePaths(dirname(kanbanFilename));
kanbanModule._compile(ts.transpileModule(readFileSync(kanbanFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, kanbanFilename);

function renderKanban({ status = 'PREPARING', assignedB = false, voidedB = false, finishedAfterA = false, startedB = false, sequential = true, paused = false } = {}) {
  const a = { id: 'a', ktvId: 'A', sequenceSlot: '1', startTime: '10:00', endTime: '10:30', duration: 30, roomId: 'R', bedId: 'X',
    ...(status === 'IN_PROGRESS' ? { actualStartTime: '2026-09-26T03:00:00Z', actualEndTime: '2026-09-26T03:30:00Z' } : {}) };
  const b = { id: 'b', ktvId: 'B', sequenceSlot: '2', startTime: '10:30', endTime: '11:00', duration: 30, roomId: 'R', bedId: 'X', voided: voidedB,
    ...(startedB ? { actualStartTime: '2026-09-26T03:30:00Z' } : {}) };
  const segments = assignedB || voidedB ? [a, b] : [a];
  const service = { id: 'item', serviceName: 'Test', duration: 60, status: paused ? 'PAUSED' : status, selectedRoomId: 'R',
    options: sequential ? { sequentialSlots: 2, finishedAfterA } : {}, staffList: segments.map(s => ({ id: s.id, ktvId: s.ktvId, ktvName: s.ktvId, segments: [s], noteForKtv: '' })) };
  const order = { id: 'child-booking', parentBookingId: 'parent-booking', billCode: 'LOCAL-001', customerName: 'Khách test',
    dispatchStatus: status, rawStatus: status, time: '10:00', services: [service], hasAssignedKtv: true };
  const originalJsx = jsxRuntime.jsx, originalJsxs = jsxRuntime.jsxs;
  let button, replaceButton, detailButton, card, detail, handoff;
  const capture = original => (...args) => {
    const element = original(...args);
    if (element.type === 'button' && element.props['aria-label']?.startsWith('Mở chi tiết đơn ')) detailButton = element;
    if (element.props?.role === 'group' && element.props?.onDoubleClick && element.props?.onKeyDown) card = element;
    if (element.type === 'button' && element.props.title === 'Mở điều phối để gán nhân viên B') button = element;
    if (element.type === 'button' && element.props['aria-label'] === 'Đổi nhân viên B') replaceButton = element;
    return element;
  };
  jsxRuntime.jsx = capture(originalJsx); jsxRuntime.jsxs = capture(originalJsxs);
  let html;
  try { html = renderToStaticMarkup(React.createElement(kanbanModule.exports.KanbanBoard, {
    orders: [order], staffs: [], onUpdateStatus() {}, onOpenDetail: (...args) => { detail = args; },
    onPauseClick() {}, onFinishEarlyPaused() {}, onCancelClick() {},
    onAssignSequentialB: (...args) => { handoff = args; },
  })); } finally { jsxRuntime.jsx = originalJsx; jsxRuntime.jsxs = originalJsxs; }
  return { html, button, replaceButton, detailButton, openDetail: () => {
    let prevented = false;
    card.props.onKeyDown({ target: card, currentTarget: card, key: 'Enter', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(detail[0], 'parent-booking');
    assert.ok(detail[1]);
    assert.equal(handoff, undefined);
  }, replace: () => {
    let stopped = false;
    replaceButton.props.onClick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(detail, undefined);
    assert.deepEqual(handoff, ['child-booking', 'item', 'A', 'B']);
  }, click: () => {
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
const replacementCard = renderKanban({ assignedB: true });
assert.ok(replacementCard.html.includes('Nối tiếp · A'));
assert.ok(replacementCard.html.includes('Lượt 1'));
assert.ok(replacementCard.html.includes('Lượt 2'));
assert.ok(!replacementCard.html.includes('A · Làm trước'));
assert.equal(replacementCard.detailButton, undefined);
assert.ok(replacementCard.html.includes('Chờ bắt đầu'));
replacementCard.replace();
for (const config of [{ assignedB: true, startedB: true }, { assignedB: true, status: 'CLEANING' },
  { voidedB: true }, { assignedB: true, finishedAfterA: true }, { assignedB: true, status: 'CANCELLED' }]) {
  assert.equal(renderKanban(config).replaceButton, undefined);
}
assert.ok(renderKanban({ assignedB: true, status: 'IN_PROGRESS', startedB: true }).html.includes('Đang làm'));
assert.ok(!renderKanban({ sequential: false }).html.includes('Nối tiếp · A'));
assert.ok(!/>\s*Kết thúc<\/button>/.test(renderKanban({ assignedB: true, status: 'IN_PROGRESS' }).html));
assert.ok(!/>\s*Huỷ<\/button>/.test(renderKanban({ assignedB: true, status: 'IN_PROGRESS' }).html));
const pausedCard = renderKanban({ assignedB: true, status: 'IN_PROGRESS', paused: true }).html;
assert.ok(/>\s*Kết thúc<\/button>/.test(pausedCard));
assert.ok(/>\s*Huỷ<\/button>/.test(pausedCard));
console.log('PASS icon: bỏ B trong nháp giữ A; đổi B từ đúng booking trên Kanban; khóa sau bắt đầu/đóng ca');

render({ sequential: true, b: true, status: 'IN_PROGRESS', startedA: true, minutes: 30 });
const durationA = actions.find(e => e.props['aria-label'] === 'Thời lượng nhân viên A');
assert.equal(durationA.props.disabled, false, 'A đang làm vẫn được đổi giờ khi B chưa bắt đầu');
durationA.props.onChange({ target: { value: '45' } });
assert.equal(lastUpdate.ktvDurations[0], 45);
assert.equal(lastUpdate.ktvStartTimes[1], '10:45');
assert.equal(lastUpdate.ktvEndTimes[1], '11:15');
console.log('PASS A30→45 dời B khi B đã gán mà chưa bắt đầu');

render({ b: true, names: ['Tên A', 'Tên B'] });
actions.find(e => e.props.onDrop).props.onDrop({ dataTransfer: { getData: () => '1' } });
assert.deepEqual(lastUpdate.selectedKtvIds, ['B', 'A']);
assert.deepEqual(lastUpdate.ktvServiceNames, ['Tên B', 'Tên A']);
console.log('PASS tên riêng khi đổi thứ tự: tên đi cùng nhân viên');

const originalAlert=global.alert;global.alert=()=>{};
try {
  render({sequential:true,b:true,status:'PREPARING',bStart:'23:50',names:['Tên A','Tên B đang sửa']});
  actions.find(e=>e.props['aria-label']==='Giờ bắt đầu B').props.onChange({target:{value:'00:10'}});
  assert.deepEqual(lastHandoff,['item','A','B']);
  assert.equal(lastUpdate,undefined);
  console.log('PASS MIDNIGHT UI: crossing midnight opens explicit date modal without changing pending name/time form');
} finally {global.alert=originalAlert;}

// Replacement uses the same attendance eligibility as adding B, including busy KTVs.
render({ sequential: true, b: true, turns: [
  { employee_id: 'C', status: 'working', check_in_time: '2026-09-26T02:00:00Z', staff: { full_name: 'C' } },
  { employee_id: 'D', status: 'assigned', check_in_time: '2026-09-26T02:00:00Z', staff: { full_name: 'D' } },
] });
const selectB = actions.find(e => e.props['aria-label'] === 'Nhân viên B');
const optionsB = React.Children.toArray(selectB.props.children).flatMap(e => Array.isArray(e) ? e : [e]);
assert.ok(optionsB.some(e => e.props?.value === 'C'));
assert.ok(optionsB.some(e => e.props?.value === 'D'));
assert.ok(actions.some(e => e.props['aria-label'] === 'Lưu dịch vụ Test (A và B)'));
actions.find(e => e.props['aria-label'] === 'Đưa A xuống sau').props.onClick();
assert.deepEqual(lastUpdate.selectedKtvIds, ['B', 'A']);
render({ sequential: true, b: true, startedB: true });
assert.equal(actions.find(e => e.props['aria-label'] === 'Đưa A xuống sau').props.disabled, true);
lastUpdate = undefined;
actions.find(e => e.props['aria-label'] === 'Đưa A xuống sau').props.onClick();
assert.equal(lastUpdate, undefined, 'shared reorder handler rejects started work even if invoked directly');
console.log('PASS UX: consistent busy B options, service Save scope, keyboard reorder and started guard');

const keyboardCard = renderKanban({ assignedB: true, status: 'IN_PROGRESS' });
assert.equal(keyboardCard.detailButton, undefined, 'Kanban has no separate detail button');
keyboardCard.openDetail();
const timerSource = readFileSync(join(__dirname, '../app/ktv/dashboard/_screens/ScreenTimer.tsx'), 'utf8');
assert.ok(timerSource.includes('aria-label={`Chụp ${photo.label.toLowerCase()}`}'));
assert.ok(timerSource.includes('aria-label={`Tải ${photo.label.toLowerCase()}`}'));
console.log('PASS Kanban bỏ nút chi tiết riêng; KTV photos have contextual labels');
