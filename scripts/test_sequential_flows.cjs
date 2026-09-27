const assert = require('node:assert/strict');
const { join } = require('node:path');
require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const SequentialDemo = require('../app/reception/dispatch/sequential-demo/SequentialDemo').default;
const { QuickDispatchTable } = require('../app/reception/dispatch/_components/QuickDispatchTable');
const { KanbanBoard } = require('../app/reception/dispatch/_components/KanbanBoard');
const SequentialLifecycleModal = require('../app/reception/dispatch/_components/SequentialLifecycleModal').default;
const { AccountDemo } = require('../app/reception/dispatch/sequential-demo/AccountDemo');
const { DispatchEditHistory } = require('../app/reception/dispatch/_components/DispatchEditHistory');
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
let app, quick, card, lifecycle;
function flush() {
  for (let pass = 0; pass < 12; pass++) {
    const tree = app.render();
    const scoped = elements(tree, e => e.type === SequentialLifecycleModal)[0];
    if (scoped) { lifecycle ||= hooks(SequentialLifecycleModal); lifecycle.render(scoped.props); }
    else lifecycle = null;
    const table = elements(tree, e => e.type === QuickDispatchTable)[0];
    if (!table) { if (!app.dirty) return; continue; }
    quick ||= hooks(QuickDispatchTable);
    const tableTree = quick.render(table.props);
    const group = elements(tableTree, e => typeof e.type === 'function' && e.type.name === 'ServiceGroupCard')[0];
    if (group) { card ||= hooks(group.type); card.render(group.props); }
    if (!app.dirty && !quick.dirty && (!card || !card.dirty) && (!lifecycle || !lifecycle.dirty)) return;
  }
  throw new Error('Flow did not settle');
}
function reset() { data.clear(); alerts.length = 0; confirmations.length = 0; allowConfirm = false; at('10:00'); app = hooks(SequentialDemo); quick = card = lifecycle = null; flush(); }
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
function name(id, value) { changeInput(elements(card.tree, e => e.props['aria-label'] === `Tên dịch vụ riêng của ${id}`)[0], value); }
function assertName(id, value) { assert.equal(row(id).serviceNameForKtv || '', value); assert.equal(service().options.serviceNamesForKtvs?.[id] || '', value); }
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
  click(app.tree, 'Chọn nhân viên làm tiếp');
  const form = () => elements(app.tree, e => e.props.role === 'dialog')[0];
  if (expectedDefault !== undefined) assert.equal(elements(form(), e => e.type === 'input' && e.props.type === 'number')[0].props.value, expectedDefault, 'Default B minutes must use actual work after A finishes');
  changeInput(elements(form(), e => e.type === 'select')[0], id);
  changeInput(elements(form(), e => e.type === 'input' && e.props.type === 'datetime-local')[0], start);
  changeInput(elements(form(), e => e.type === 'input' && e.props.type === 'number')[0], duration);
  click(form(), 'Lưu & điều phối');
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
  reset(); chooseA();
  const packageName = service().options.displayName;
  name('DEMO-A', 'Massage riêng A'); assert.equal(service().options.displayName, packageName);
  minutes(0, 30); sequential(); chooseDraftB();
  assertName('DEMO-A', 'Massage riêng A'); assertName('DEMO-B', '');
  assert.equal(elements(card.tree, e => e.props['aria-label'] === 'Tên dịch vụ chung')[0].props.readOnly, true);
  name('DEMO-B', 'Gội riêng B'); assertName('DEMO-A', 'Massage riêng A');
  name('DEMO-A', 'Massage A đã sửa'); assertName('DEMO-B', 'Gội riêng B');
  name('DEMO-A', ''); assertName('DEMO-A', ''); assertName('DEMO-B', 'Gội riêng B');
  name('DEMO-A', 'Massage A đã sửa');
  assert.equal(service().status, 'NEW'); checkPlan('DEMO-A', '10:00', 30); checkPlan('DEMO-B', '10:30', 30);
  assert.equal(demoAccountState(service(), 'DEMO-B', now).assigned, false);
  send();
  const untouchedTimes = service().staffList.map(row => structuredClone(row.segments));
  name('DEMO-B', 'Gội B sau gửi'); assertName('DEMO-A', 'Massage A đã sửa');
  name('DEMO-A', 'Massage A sau gửi'); assertName('DEMO-B', 'Gội B sau gửi');
  assert.deepEqual(service().staffList.map(row => row.segments), untouchedTimes);
  const bHtml = renderToStaticMarkup(React.createElement(AccountDemo, { service: service(), employeeId: 'DEMO-B', employeeName: 'B', now, onStamp() {} }));
  assert.ok(bHtml.includes('10:30') && !bHtml.includes('10:00'));
  assert.ok(bHtml.includes('Gội B sau gửi') && !bHtml.includes('Massage A sau gửi'));
  closeBoth();
  console.log('PASS FLOW 1/5: Tạo mới → A30/B30 → gửi cùng lúc → giờ riêng → A/B xong → đánh giá → DONE');

  // 2. A initially sent as full 60, shorten before starting, then add B.
  reset(); chooseA(); send(); name('DEMO-A', 'Tên riêng A trước B'); checkPlan('DEMO-A', '10:00', 60);
  minutes(0, 30); checkPlan('DEMO-A', '10:00', 30);
  assert.equal(segmentOf(row('DEMO-A')).actualStartTime, undefined);
  sequential(); assignLiveB(); checkPlan('DEMO-B', '10:30', 30); assertName('DEMO-A', 'Tên riêng A trước B'); assertName('DEMO-B', ''); closeBoth();
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
  name('DEMO-A', 'Tên A giữ nguyên'); name('DEMO-B', 'Tên B cũ');
  checkPlan('DEMO-A', '10:00', 30); checkPlan('DEMO-B', '10:30', 30);
  const removeB = elements(card.tree, e => e.type === 'button' && e.props['aria-label'] === 'Bỏ nhân viên hàng 2 khỏi bản nháp')[0];
  assert.ok(removeB && !removeB.props.disabled); removeB.props.onClick({ stopPropagation() {} }); flush();
  chooseDraftB('DEMO-C'); checkPlan('DEMO-C', '10:30', 30);
  assertName('DEMO-C', ''); assertName('DEMO-A', 'Tên A giữ nguyên');
  name('DEMO-C', 'Tên C riêng'); send();
  const aBefore = structuredClone(segmentOf(row('DEMO-A')));
  changeInput(elements(card.tree, e => e.props['aria-label'] === 'Giờ bắt đầu B')[0], '10:50');
  click(card.tree, 'Lưu & điều phối B');
  checkPlan('DEMO-C', '10:50', 30); assert.deepEqual(segmentOf(row('DEMO-A')), aBefore);
  const oldAccount = elements(app.tree, e => e.type === AccountDemo && e.props.employeeId === 'DEMO-C')[0];
  assignLiveB('DEMO-B', '2026-09-26T10:50', 30);
  assert.equal(service().staffList.find(row => row.ktvId === 'DEMO-C').segments[0].voided, true);
  oldAccount.props.onStamp('DEMO-C', 'actualStartTime'); flush(); assert.equal(alerts.length, 1); alerts.length = 0;
  assert.equal(liveRows().length, 2); checkPlan('DEMO-B', '10:50', 30);
  assertName('DEMO-B', 'Tên B cũ'); assertName('DEMO-A', 'Tên A giữ nguyên');
  closeBoth('DEMO-A', 'DEMO-B', '10:30', '10:50', '11:20');
  console.log('PASS FLOW 4/5: Sửa phút A/B + đổi B trong nháp → gửi → nhập tay giờ B → đổi B live → chặn tài khoản B cũ → DONE');

  // 5. Finish after A; cancelled B cannot begin even from a pre-rendered handler.
  reset(); chooseA(); minutes(0, 30); sequential(); chooseDraftB();
  name('DEMO-A', 'Tên A reload'); name('DEMO-B', 'Tên B reload'); send();
  const oldB = elements(app.tree, e => e.type === AccountDemo && e.props.employeeId === 'DEMO-B')[0];
  stamp('DEMO-A', 'actualStartTime', '10:00'); stamp('DEMO-A', 'actualEndTime', '10:30');
  click(app.tree, 'Kết thúc');
  assert.ok(lifecycle);
  const confirmScope = elements(lifecycle.tree, e => e.type === 'button' && textOf(e) === 'Xác nhận')[0];
  assert.equal(confirmScope.props.disabled, true, 'Admin must explicitly choose scope');
  changeInput(elements(lifecycle.tree, e => e.type === 'input' && e.props.value === 'both')[0], 'both');
  click(lifecycle.tree, 'Xác nhận'); assert.equal(service().status, 'CLEANING');
  assert.ok(service().options.closedSequentialSlots.includes(2));
  assert.equal(demoAccountState(service(), 'DEMO-B', now).assigned, false);
  oldB.props.onStamp('DEMO-B', 'actualStartTime'); flush(); assert.equal(alerts.length, 1);
  assert.equal(service().staffList.find(row => row.ktvId === 'DEMO-B').segments[0].actualStartTime, undefined);
  app = hooks(SequentialDemo); quick = card = lifecycle = null; flush();
  assertName('DEMO-A', 'Tên A reload');
  assert.equal(service().staffList.find(row => row.ktvId === 'DEMO-B').serviceNameForKtv, 'Tên B reload');
  name('DEMO-A', 'Tên A reload sửa');
  assert.equal(service().staffList.find(row => row.ktvId === 'DEMO-B').serviceNameForKtv, 'Tên B reload');
  assert.equal(service().status, 'CLEANING'); assert.ok(service().options.closedSequentialSlots.includes(2));
  finishRoom();
  console.log('PASS FLOW 5/5: Hoàn thành sau A → hủy B chưa làm → chặn handler cũ → reload giữ kết quả → DONE');
  console.log('PASS TÊN RIÊNG: sửa/xóa A không đổi B; sửa B không đổi A; B mới không kế thừa tên; giữ tên sau gửi/reload, không đổi giờ');
  // Audit continuity and stale edits through actual demo handlers/components.
  reset(); chooseA(); name('DEMO-A','Tên A lần 1');
  app = hooks(SequentialDemo); quick = card = lifecycle = null; flush();
  assertName('DEMO-A','Tên A lần 1'); name('DEMO-A','Tên A lần 2');
  const named = service().options.dispatchHistory.at(-1).changes.find(c=>c.field==='serviceNameForKtv');
  assert.equal(named.before,'Tên A lần 1'); assert.equal(named.after,'Tên A lần 2');
  assert.equal(service().options.dispatchHistory.at(-1).actor.id,'DEMO-ADMIN');
  const historyMarkup = renderToStaticMarkup(React.createElement(DispatchEditHistory,{services:[service()]}));
  assert.ok(historyMarkup.includes('Tên A lần 1') && historyMarkup.includes('Tên A lần 2') && historyMarkup.includes('Quầy demo'));
  console.log('PASS HISTORY UI 1/5: Reload → sửa lần 2 dựa trên lần 1; lưu người sửa và trước/sau');

  minutes(0,30); sequential(); send(); assignLiveB('DEMO-B','2026-09-26T10:45',25);
  click(app.tree,'Chọn nhân viên làm tiếp');
  let form = elements(app.tree,e=>e.props.role==='dialog')[0];
  assert.equal(elements(form,e=>e.props.type==='datetime-local')[0].props.value,'2026-09-26T10:45');
  assert.equal(elements(form,e=>e.props.type==='number')[0].props.value,25);
  changeInput(elements(form,e=>e.props.type==='datetime-local')[0],'2026-09-26T10:50');
  click(app.tree,'Lưu & điều phối');
  const latestB = service().options.dispatchHistory.at(-1);
  assert.equal(latestB.action,'ASSIGN_B');
  assert.equal(latestB.changes.find(c=>c.field==='startTime').before,'10:45');
  checkPlan('DEMO-B','10:50',25); checkPlan('DEMO-A','10:00',30);
  console.log('PASS HISTORY UI 2/5: Modal B lần 2 mở đúng giờ/phút lần 1, không quay về mốc A');

  click(app.tree,'Chọn nhân viên làm tiếp');
  const oldSave = elements(app.tree,e=>e.type==='button' && textOf(e)==='Lưu & điều phối')[0];
  const oldTable = elements(app.tree,e=>e.type===QuickDispatchTable)[0];
  const oldServices = structuredClone(oldTable.props.services);
  name('DEMO-A','Tên A mới nhất'); const beforeStale=order();
  oldSave.props.onClick(); flush();
  assert.match(alerts.at(-1),/bản lưu mới/); assert.deepEqual(order(),beforeStale);
  oldTable.props.onUpdateServices(oldServices); flush();
  assert.match(alerts.at(-1),/bản lưu mới/); assert.deepEqual(order(),beforeStale);
  console.log('PASS HISTORY UI 3/5: Modal / callback tab cũ bị chặn, không xóa bản mới hoặc nhật ký');

  // Exercise reinitialization where ONLY endTime changes (no revision/start/duration change).
  const props = elements(app.tree,e=>e.type===QuickDispatchTable)[0].props;
  const independent = hooks(QuickDispatchTable);
  independent.render(props); independent.render(props);
  const changedServices = structuredClone(props.services);
  changedServices[0].staffList[0].segments[0].endTime='11:15';
  const newProps={...props,services:changedServices};
  independent.render(newProps);
  const tree=independent.render(newProps);
  let group=elements(tree,e=>typeof e.type==='function' && e.type.name==='ServiceGroupCard')[0];
  assert.equal(group.props.state.ktvEndTimes[0],'11:15');
  console.log('PASS HISTORY UI 4/5: Chỉ đổi giờ kết thúc vẫn cập nhật bảng, không giữ giá trị cũ');

  const missingServices=structuredClone(props.services);
  missingServices[0].options.sequentialSlots=undefined;
  missingServices[0].staffList=missingServices[0].staffList.slice(0,1);
  missingServices[0].staffList[0].segments[0].startTime='';
  delete missingServices[0].staffList[0].segments[0].endTime;
  const missingProps={...props,services:missingServices};
  independent.render(missingProps);
  group=elements(independent.render(missingProps),e=>typeof e.type==='function' && e.type.name==='ServiceGroupCard')[0];
  assert.equal(group.props.state.ktvStartTimes[0],''); assert.equal(group.props.state.ktvEndTimes[0],'');
  console.log('PASS HISTORY UI 5/5: Chặng đã lưu thiếu giờ không tự lấy giờ hiện tại / tính giờ kết thúc');

  reset(); chooseA(); minutes(0,30); send(); sequential(); assignLiveB();
  const preservedA=structuredClone(segmentOf(row('DEMO-A')));
  name('DEMO-A','Tên A cố định'); name('DEMO-B','Tên B lần 1');
  changeInput(elements(card.tree,e=>e.props['aria-label']==='Giờ bắt đầu B')[0],'10:45');
  click(app.tree,'Lưu thông tin'); click(card.tree,'Lưu & điều phối B');
  checkPlan('DEMO-B','10:45',30); assertName('DEMO-B','Tên B lần 1');
  assert.equal(segmentOf(row('DEMO-B')).plannedStartAt,'2026-09-26T03:45:00.000Z');
  const accountBHtml=renderToStaticMarkup(React.createElement(AccountDemo,{service:service(),employeeId:'DEMO-B',employeeName:'B',now}));
  assert.ok(accountBHtml.includes('Tên B lần 1') && accountBHtml.includes('10:45'));
  assert.deepEqual(segmentOf(row('DEMO-A')),preservedA); assertName('DEMO-A','Tên A cố định');
  app=hooks(SequentialDemo); quick=card=null; flush();
  assertName('DEMO-B','Tên B lần 1'); checkPlan('DEMO-B','10:45',30);
  name('DEMO-B','Tên B lần 2'); changeInput(elements(card.tree,e=>e.props['aria-label']==='Giờ bắt đầu B')[0],'11:10');
  click(app.tree,'Cập nhật & điều phối B'); checkPlan('DEMO-B','11:10',30);
  assertName('DEMO-B','Tên B lần 2'); assertName('DEMO-A','Tên A cố định');
  assert.deepEqual(segmentOf(row('DEMO-A')),preservedA);
  assert.equal(service().options.dispatchHistory.at(-1).action,'DISPATCH');
  console.log('PASS UPDATE B UI: A gửi trước → gán B sau → sửa tên/giờ → lưu & điều phối → tài khoản B/reload → sửa lần 2; A giữ nguyên');


  reset(); chooseA(); minutes(0,30); send(); sequential(); assignLiveB();
  const originalB = structuredClone(segmentOf(row('DEMO-B')));
  at('10:01'); assignLiveB('DEMO-C','2026-09-26T10:40',20);
  at('10:02'); assignLiveB('DEMO-B','2026-09-26T10:50',10);
  assert.equal(service().staffList.filter(person=>person.ktvId==='DEMO-B').length,1);
  assert.equal(row('DEMO-B').segments.length,2);
  assert.equal(row('DEMO-B').segments.find(segment=>segment.id===originalB.id).voided,true);
  assert.notEqual(segmentOf(row('DEMO-B')).id,originalB.id);
  checkPlan('DEMO-B','10:50',10);
  name('DEMO-B','B quay lại');
  changeInput(elements(card.tree,e=>e.props['aria-label']==='Giờ bắt đầu B')[0],'10:55');
  checkPlan('DEMO-B','10:55',10); assertName('DEMO-B','B quay lại');
  stamp('DEMO-B','actualStartTime','10:55');
  const liveActual=segmentOf(row('DEMO-B')).actualStartTime;
  name('DEMO-B','B đã bắt đầu');
  assert.equal(segmentOf(row('DEMO-B')).actualStartTime,liveActual);
  assert.equal(row('DEMO-B').segments.find(segment=>segment.id===originalB.id).actualStartTime,undefined);
  app=hooks(SequentialDemo);quick=card=null;flush();
  checkPlan('DEMO-B','10:55',10);assertName('DEMO-B','B đã bắt đầu');
  assert.equal(segmentOf(row('DEMO-B')).actualStartTime,liveActual);
  assert.equal(demoAccountState(service(),'DEMO-C',now).canStart,false);
  const legacySnapshot=order();
  const legacyB=legacySnapshot.services[0].staffList.find(person=>person.ktvId==='DEMO-B');
  const legacyOld=structuredClone(legacyB);legacyOld.segments=legacyOld.segments.filter(segment=>segment.voided===true);
  legacyB.segments=legacyB.segments.filter(segment=>segment.voided!==true);
  legacySnapshot.services[0].staffList.splice(1,0,legacyOld);
  data.set(key,JSON.stringify(legacySnapshot));
  app=hooks(SequentialDemo);quick=card=null;flush();
  name('DEMO-B','B đã bắt đầu');
  assert.equal(service().staffList.filter(person=>person.ktvId==='DEMO-B').length,1);
  assert.equal(row('DEMO-B').segments.length,2);
  checkPlan('DEMO-B','10:55',10);
  assert.equal(segmentOf(row('DEMO-B')).actualStartTime,liveActual);
  console.log('PASS RETURNING B DEMO: B → C → B keeps one row/history, latest plan/name and actual stamp across edit/reload; old C cannot start');

} finally { global.Date = originalDate; console.log = originalLog; }
