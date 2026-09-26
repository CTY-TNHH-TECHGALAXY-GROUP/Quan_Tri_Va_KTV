const assert = require('node:assert/strict');
const { join } = require('node:path');
require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const SequentialDemo = require('../app/reception/dispatch/sequential-demo/SequentialDemo').default;
const { QuickDispatchTable } = require('../app/reception/dispatch/_components/QuickDispatchTable');
const { KanbanBoard } = require('../app/reception/dispatch/_components/KanbanBoard');
const { AccountDemo } = require('../app/reception/dispatch/sequential-demo/AccountDemo');
const { demoAccountState, segmentOf } = require('../app/reception/dispatch/sequential-demo/demo-account');
const key = 'dispatch-sequential-demo-v2';
const originalDate = Date;
let now = Date.parse('2026-09-26T10:00:00+07:00');
global.Date = class extends originalDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
const at = time => { now = Date.parse(`2026-09-26T${time}:00+07:00`); };
const data = new Map();
const alerts = [], confirmations = [];
global.localStorage = { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
global.window = { location: { search: '' }, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
global.document = { addEventListener() {}, removeEventListener() {} };
global.alert = text => alerts.push(text);
let allowConfirm = false;
global.confirm = text => { confirmations.push(text); return allowConfirm; };
function elements(tree, match) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(match(tree) ? [tree] : []), ...React.Children.toArray(tree.props?.children).flatMap(child => elements(child, match))];
}
const textOf = e => typeof e === 'string' || typeof e === 'number' ? String(e) : e && typeof e === 'object' ? React.Children.toArray(e.props?.children).map(textOf).join('') : '';
// Execute the actual component hooks and effects; no copied dispatch transformation.
function hooks(Component) {
  const slots = [];
  return { dirty: true, render(props = {}) {
    const saved = Object.fromEntries(['useState', 'useRef', 'useMemo', 'useEffect'].map(k => [k, React[k]]));
    let index = 0; const effects = []; this.dirty = false;
    const changed = (old, deps) => !old || !deps || deps.some((value, i) => !Object.is(value, old[i]));
    React.useState = initial => {
      const i = index++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; this.dirty = true; } }];
    };
    React.useRef = initial => { const i = index++; slots[i] ||= { current: initial }; return slots[i]; };
    React.useMemo = (fn, deps) => { const i = index++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; };
    React.useEffect = (fn, deps) => { const i = index++; if (!slots[i] || changed(slots[i].deps, deps)) { slots[i] = { deps }; effects.push(fn); } };
    try { this.tree = Component(props); } finally { Object.assign(React, saved); }
    effects.forEach(fn => fn());
    return this.tree;
  } };
}
let app, quick, card;
function flush() {
  for (let pass = 0; pass < 12; pass++) {
    const tree = app.render();
    const table = elements(tree, e => e.type === QuickDispatchTable)[0];
    if (!table) { if (!app.dirty) return; continue; }
    quick ||= hooks(QuickDispatchTable);
    const tableTree = quick.render(table.props);
    const group = elements(tableTree, e => typeof e.type === 'function' && e.type.name === 'ServiceGroupCard')[0];
    if (group) { card ||= hooks(group.type); card.render(group.props); }
    if (!app.dirty && !quick.dirty && (!card || !card.dirty)) return;
  }
  throw new Error('Flow did not settle');
}
function reset() { data.clear(); alerts.length = 0; confirmations.length = 0; allowConfirm = false; at('10:00'); app = hooks(SequentialDemo); quick = card = null; flush(); }
const order = () => JSON.parse(data.get(key));
const service = () => order().services[0];
const liveRows = () => service().staffList.filter(row => segmentOf(row).voided !== true);
const row = id => service().staffList.find(row => row.ktvId === id && segmentOf(row).voided !== true);
function changeInput(input, value) { assert.ok(input && !input.props.disabled, 'Expected editable input'); input.props.onChange({ target: { value: String(value) } }); flush(); }
function click(tree, label) { const button = elements(tree, e => e.type === 'button' && textOf(e) === label)[0]; assert.ok(button, `Missing button: ${label}`); assert.ok(!button.props.disabled, `Disabled button: ${label}`); button.props.onClick({ stopPropagation() {} }); flush(); }
function chooseA(id = 'DEMO-A') {
  const search = () => elements(card.tree, e => e.type === 'input' && e.props.type === 'text' && e.props.onKeyDown)[0];
  changeInput(search(), id);
  search().props.onKeyDown({ key: 'Enter', preventDefault() {} }); flush();
  const room = elements(card.tree, e => e.type === 'select' && React.Children.toArray(e.props.children).some(o => o.props?.value === 'R01'))[0];
  changeInput(room, 'R01');
  changeInput(elements(card.tree, e => e.type === 'input' && e.props.type === 'time')[0], '10:00');
}
function minutes(index, value) { changeInput(elements(card.tree, e => e.type === 'input' && e.props.placeholder === 'Phút')[index], value); }
function sequential() { const add = elements(card.tree, e => e.type === 'button' && textOf(e).includes('+ Nối tiếp'))[0]; assert.ok(add); add.props.onClick(); flush(); }
function chooseDraftB(id = 'DEMO-B') { changeInput(elements(card.tree, e => e.props['aria-label'] === 'Chọn nhân viên B')[0], id); }
function send() { const label = liveRows().length > 1 ? 'Gửi phân công A + B' : 'Gửi phân công A'; click(app.tree, label); assert.equal(service().status, 'PREPARING'); }
function stamp(id, field, time) {
  at(time);
  const account = elements(app.tree, e => e.type === AccountDemo && e.props.employeeId === id)[0];
  assert.ok(account, `Missing account ${id}`); account.props.onStamp(id, field); flush();
}
function assignLiveB(id = 'DEMO-B', start = '2026-09-26T10:30', duration = 30, expectedDefault) {
  click(app.tree, 'Gán / sửa B');
  const form = () => elements(app.tree, e => e.props.role === 'dialog')[0];
  if (expectedDefault !== undefined) assert.equal(elements(form(), e => e.type === 'input' && e.props.type === 'number')[0].props.value, expectedDefault, 'Default B minutes must use actual work after A finishes');
  changeInput(elements(form(), e => e.type === 'select')[0], id);
  changeInput(elements(form(), e => e.type === 'input' && e.props.type === 'datetime-local')[0], start);
  changeInput(elements(form(), e => e.type === 'input' && e.props.type === 'number')[0], duration);
  click(form(), 'Lưu B');
}
function checkPlan(id, start, duration) { const segment = segmentOf(row(id)); assert.equal(segment.startTime, start); assert.equal(segment.duration, duration); }
function finishRoom() {
  const before = service().staffList.map(row => [segmentOf(row).actualStartTime, segmentOf(row).actualEndTime]);
  const kanban = () => elements(app.tree, e => e.type === KanbanBoard)[0];
  kanban().props.onUpdateStatus(order().id, 'FEEDBACK'); flush();
  assert.equal(service().status, 'FEEDBACK');
  kanban().props.onCustomerRating(order().id, 5); flush();
  kanban().props.onUpdateStatus(order().id, 'DONE'); flush();
  assert.equal(service().status, 'DONE'); assert.equal(order().rating, 5);
  assert.deepEqual(service().staffList.map(row => [segmentOf(row).actualStartTime, segmentOf(row).actualEndTime]), before);
}
function closeBoth(a = 'DEMO-A', b = 'DEMO-B', aEnd = '10:30', bStart = '10:30', bEnd = '11:00') {
  stamp(a, 'actualStartTime', '10:00'); stamp(a, 'actualEndTime', aEnd);
  assert.equal(service().status, 'IN_PROGRESS');
  const before = structuredClone(segmentOf(row(a)));
  stamp(b, 'actualStartTime', bStart); stamp(b, 'actualEndTime', bEnd);
  assert.equal(service().status, 'CLEANING'); assert.deepEqual(segmentOf(row(a)), before);
  assert.equal(alerts.length, 0, alerts.join('; '));
  finishRoom();
}
const originalLog = console.log;
console.log = (...args) => { if (String(args[0]).startsWith('PASS')) originalLog(...args); };
try {
  // 1. New package, A 30 + B 30 selected before initial dispatch.
  reset(); chooseA(); minutes(0, 30); sequential(); chooseDraftB();
  assert.equal(service().status, 'NEW'); checkPlan('DEMO-A', '10:00', 30); checkPlan('DEMO-B', '10:30', 30);
  assert.equal(demoAccountState(service(), 'DEMO-B', now).assigned, false);
  send();
  const bHtml = renderToStaticMarkup(React.createElement(AccountDemo, { service: service(), employeeId: 'DEMO-B', employeeName: 'B', now, onStamp() {} }));
  assert.ok(bHtml.includes('10:30') && !bHtml.includes('10:00'));
  closeBoth();
  console.log('PASS FLOW 1/5: Tạo mới → A30/B30 → gửi cùng lúc → giờ riêng → A/B xong → đánh giá → DONE');

  // 2. A initially sent as full 60, shorten before starting, then add B.
  reset(); chooseA(); send(); checkPlan('DEMO-A', '10:00', 60);
  minutes(0, 30); checkPlan('DEMO-A', '10:00', 30);
  assert.equal(segmentOf(row('DEMO-A')).actualStartTime, undefined);
  sequential(); assignLiveB(); checkPlan('DEMO-B', '10:30', 30); closeBoth();
  // The running-A variant must preserve actual timestamps and the locked plan.
  reset(); chooseA(); send(); stamp('DEMO-A', 'actualStartTime', '10:00');
  assert.equal(elements(card.tree, e => e.type === 'input' && e.props.placeholder === 'Phút')[0].props.disabled, true);
  const runningA = structuredClone(segmentOf(row('DEMO-A')));
  sequential(); assert.equal(segmentOf(row('DEMO-A')).actualStartTime, runningA.actualStartTime);
  stamp('DEMO-A', 'actualEndTime', '10:30');
  assert.equal(service().status, 'IN_PROGRESS');
  assignLiveB('DEMO-B', '2026-09-26T10:30', 30, 30); checkPlan('DEMO-B', '10:30', 30);
  assert.equal(demoAccountState(service(), 'DEMO-A', now).elapsedMs, 30 * 60_000);
  stamp('DEMO-B', 'actualStartTime', '10:30'); stamp('DEMO-B', 'actualEndTime', '11:00');
  assert.equal(service().status, 'CLEANING'); finishRoom();
  console.log('PASS FLOW 2/5: Gửi A full60 → sửa A30 trước bắt đầu; A đang chạy dừng thực ở30 → B30 → DONE');

  // 3. A finishes while B has never been selected; later B gets its own plan.
  reset(); chooseA(); minutes(0, 30); sequential(); send();
  assert.equal(liveRows().length, 1);
  stamp('DEMO-A', 'actualStartTime', '10:00'); stamp('DEMO-A', 'actualEndTime', '10:30');
  assert.equal(service().status, 'IN_PROGRESS');
  const endedA = structuredClone(segmentOf(row('DEMO-A')));
  assignLiveB(); assert.deepEqual(segmentOf(row('DEMO-A')), endedA);
  stamp('DEMO-B', 'actualStartTime', '10:35'); stamp('DEMO-B', 'actualEndTime', '11:05');
  assert.equal(service().status, 'CLEANING'); assert.deepEqual(segmentOf(row('DEMO-A')), endedA);
  finishRoom();
  console.log('PASS FLOW 3/5: A làm trước/B trống → A xong vẫn chờ → gán B sau → không sửa mốc A → DONE');

  // 4. Change a draft B, send, edit B time, replace unstarted B, reject the stale account.
  reset(); chooseA(); minutes(0, 40); sequential(); chooseDraftB();
  minutes(0, 30); minutes(1, 30);
  checkPlan('DEMO-A', '10:00', 30); checkPlan('DEMO-B', '10:30', 30);
  const removeB = elements(card.tree, e => e.type === 'button' && e.props.className?.includes('ml-1 hover:opacity-60'))[1];
  assert.ok(removeB && !removeB.props.disabled); removeB.props.onClick({ stopPropagation() {} }); flush();
  chooseDraftB('DEMO-C'); checkPlan('DEMO-C', '10:30', 30); send();
  const aBefore = structuredClone(segmentOf(row('DEMO-A')));
  changeInput(elements(card.tree, e => e.props['aria-label'] === 'Giờ bắt đầu B')[0], '10:50');
  click(card.tree, 'Lưu giờ B'); click(elements(app.tree, e => e.props.role === 'dialog')[0], 'Lưu B');
  checkPlan('DEMO-C', '10:50', 30); assert.deepEqual(segmentOf(row('DEMO-A')), aBefore);
  const oldAccount = elements(app.tree, e => e.type === AccountDemo && e.props.employeeId === 'DEMO-C')[0];
  assignLiveB('DEMO-B', '2026-09-26T10:50', 30);
  assert.equal(service().staffList.find(row => row.ktvId === 'DEMO-C').segments[0].voided, true);
  oldAccount.props.onStamp('DEMO-C', 'actualStartTime'); flush(); assert.equal(alerts.length, 1); alerts.length = 0;
  assert.equal(liveRows().length, 2); checkPlan('DEMO-B', '10:50', 30);
  closeBoth('DEMO-A', 'DEMO-B', '10:30', '10:50', '11:20');
  console.log('PASS FLOW 4/5: Sửa phút A/B + đổi B trong nháp → gửi → nhập tay giờ B → đổi B live → chặn tài khoản B cũ → DONE');

  // 5. Finish after A; cancelled B cannot begin even from a pre-rendered handler.
  reset(); chooseA(); minutes(0, 30); sequential(); chooseDraftB(); send();
  const oldB = elements(app.tree, e => e.type === AccountDemo && e.props.employeeId === 'DEMO-B')[0];
  stamp('DEMO-A', 'actualStartTime', '10:00'); stamp('DEMO-A', 'actualEndTime', '10:30');
  click(app.tree, 'Hoàn thành'); assert.equal(service().status, 'CLEANING');
  assert.equal(service().options.finishedAfterA, true);
  assert.equal(demoAccountState(service(), 'DEMO-B', now).assigned, false);
  oldB.props.onStamp('DEMO-B', 'actualStartTime'); flush(); assert.equal(alerts.length, 1);
  assert.equal(service().staffList.find(row => row.ktvId === 'DEMO-B').segments[0].actualStartTime, undefined);
  app = hooks(SequentialDemo); quick = card = null; flush();
  assert.equal(service().status, 'CLEANING'); assert.equal(service().options.finishedAfterA, true);
  finishRoom();
  console.log('PASS FLOW 5/5: Hoàn thành sau A → hủy B chưa làm → chặn handler cũ → reload giữ kết quả → DONE');
} finally { global.Date = originalDate; console.log = originalLog; }
