const assert = require('node:assert/strict');
const { join } = require('node:path');
require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AccountDemo } = require('../app/reception/dispatch/sequential-demo/AccountDemo');
const { demoAccountState, stampDemoAccount, segmentOf } = require('../app/reception/dispatch/sequential-demo/demo-account');
const { ScreenTimer } = require('../app/ktv/dashboard/_screens/ScreenTimer');
// Unopened dialogs and the attendance widget are outside this display test.
const modalPath = require.resolve('../app/ktv/dashboard/_components/modals');
require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true, exports: Object.fromEntries(['ProcedureModal', 'RoomIssueModal', 'RejectOrderModal', 'TurnQueueTypeDModal', 'OfficeScoreModal'].map(name => [name, () => null])) };
const reminderPath = require.resolve('../app/ktv/dashboard/_components/CheckInReminder');
require.cache[reminderPath] = { id: reminderPath, filename: reminderPath, loaded: true, exports: { CheckInReminder: () => null } };
const { ScreenDashboard } = require('../app/ktv/dashboard/_screens/ScreenDashboard');
const { ToastProvider } = require('../components/ui/Toast');
const SequentialDemo = require('../app/reception/dispatch/sequential-demo/SequentialDemo').default;
const at = time => Date.parse(`2026-09-26T${time}:00+07:00`);
function fixture() {
  return { id: 'order', createdAt: new Date(at('10:00')).toISOString(), services: [{ id: 'item', serviceId: 'NHS0001',
    serviceName: 'Dịch vụ mẫu', status: 'PREPARING', duration: 60, options: { sequentialSlots: 2 },
    staffList: ['DEMO-A', 'DEMO-B'].map((id, idx) => ({ id, ktvId: id, ktvName: id, noteForKtv: '', segments: [{
      id: `segment-${id}`, ktvId: id, roomId: 'R', bedId: 'X', sequenceSlot: idx + 1,
      startTime: idx ? '10:45' : '10:00', endTime: idx ? '11:00' : '10:30', duration: idx ? 15 : 30,
    }] })) }] };
}
function renderAccount(service, id) {
  return renderToStaticMarkup(React.createElement(AccountDemo, { service, employeeId: id, employeeName: id, now: at('11:00'), onStamp() {} }));
}
function renderTimer(service, id, Screen = ScreenTimer) {
  return renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(Screen, { logic: {
    ktvId: id, activeSegmentIndex: 0, timeRemaining: 900, prepTimeRemaining: 0,
    prepProcedure: [], checklist: [], turnData: {}, pendingHandovers: [],
    booking: { id: 'order', status: 'PREPARING', acceptedAt: '2026-09-26T03:00:00Z', assignedItemId: 'item', assignedItemIds: ['item'], dispatchStartTime: '10:00', timeStart: '10:00',
      BookingItems: [{ ...service, service_name: service.serviceName, segments: service.staffList.flatMap(row => row.segments) }] },
    settings: {},
  } })));
}
let service = fixture().services[0];
const aHtml = renderAccount(service, 'DEMO-A');
const bHtml = renderAccount(service, 'DEMO-B');
assert.ok(aHtml.includes('10:00') && aHtml.includes('10:30'));
assert.ok(!aHtml.includes('10:45'));
assert.ok(bHtml.includes('10:45') && bHtml.includes('11:00'));
assert.ok(!bHtml.includes('10:00') && !bHtml.includes('10:30'));
const timerB = renderTimer(service, 'DEMO-B');
assert.ok(timerB.includes('10:45') && timerB.includes('11:00'));
assert.ok(!timerB.includes('10:00') && !timerB.includes('10:30'));
const timerA = renderTimer(service, 'DEMO-A');
assert.ok(timerA.includes('10:00') && timerA.includes('10:30') && !timerA.includes('10:45'));
const dashboardB = renderTimer(service, 'DEMO-B', ScreenDashboard);
assert.ok(dashboardB.includes('10:45') && dashboardB.includes('11:00'));
assert.ok(!dashboardB.includes('10:00') && !dashboardB.includes('10:30'));
console.log('PASS 1/5: Tài khoản, ScreenDashboard và ScreenTimer thật lấy giờ assign riêng A 10:00/B 10:45');

stampDemoAccount(service, 'DEMO-A', 'actualStartTime', at('10:05'));
assert.equal(demoAccountState(service, 'DEMO-A', at('10:15')).elapsedMs, 10 * 60_000);
assert.equal(demoAccountState(service, 'DEMO-B', at('10:15')).elapsedMs, 0);
assert.equal(demoAccountState(service, 'DEMO-B', at('10:15')).remainingMs, 15 * 60_000);
assert.ok(!renderAccount(service, 'DEMO-B').includes('10:05'));
const beforeA = structuredClone(segmentOf(service.staffList[0]));
stampDemoAccount(service, 'DEMO-B', 'actualStartTime', at('10:45'));
assert.deepEqual(segmentOf(service.staffList[0]), beforeA);
assert.equal(demoAccountState(service, 'DEMO-B', at('10:50')).elapsedMs, 5 * 60_000);
assert.equal(demoAccountState(service, 'DEMO-A', at('10:50')).elapsedMs, 45 * 60_000);
console.log('PASS 2/5: A bắt đầu không chạy đồng hồ B; B bắt đầu không ghi đè A');

const beforeB = structuredClone(segmentOf(service.staffList[1]));
stampDemoAccount(service, 'DEMO-A', 'actualEndTime', at('10:55'));
assert.deepEqual(segmentOf(service.staffList[1]), beforeB);
assert.equal(service.status, 'IN_PROGRESS');
assert.equal(demoAccountState(service, 'DEMO-A', at('11:10')).elapsedMs, 50 * 60_000);
stampDemoAccount(service, 'DEMO-B', 'actualEndTime', at('11:00'));
assert.equal(service.status, 'CLEANING');
assert.equal(demoAccountState(service, 'DEMO-B', at('11:10')).elapsedMs, 15 * 60_000);
assert.equal(segmentOf(service.staffList[0]).actualEndTime, new Date(at('10:55')).toISOString());
console.log('PASS 3/5: Kết thúc/dừng đồng hồ từng người riêng; cả hai xong mới CLEANING');

service = fixture().services[0];
service.status = 'NEW';
assert.ok(renderAccount(service, 'DEMO-B').includes('Chưa có phân công'));
service.status = 'PREPARING';
segmentOf(service.staffList[1]).voided = true;
assert.equal(demoAccountState(service, 'DEMO-B', at('11:00')).assigned, false);
assert.ok(stampDemoAccount(service, 'DEMO-B', 'actualStartTime', at('10:45')));
assert.ok(stampDemoAccount(service, 'DEMO-C', 'actualStartTime', at('10:45')));
assert.ok(!segmentOf(service.staffList[0]).actualStartTime);
service.staffList.push({ ...structuredClone(service.staffList[1]), ktvId: 'DEMO-C', segments: [{ ...segmentOf(service.staffList[1]), ktvId: 'DEMO-C', voided: false }] });
assert.equal(demoAccountState(service, 'DEMO-C', at('11:00')).segment.startTime, '10:45');
console.log('PASS 4/5: Nháp/chưa gán/người B bị thay không mượn giờ A; người thay nhận đúng giờ B');

// Run the actual demo hooks/handlers with two independent tab states and one localStorage.
const key = 'dispatch-sequential-demo-v2';
const data = new Map([[key, JSON.stringify(fixture())]]);
const listeners = new Map();
const originals = { useState: React.useState, useEffect: React.useEffect, window: global.window, localStorage: global.localStorage };
global.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
function tab(account) {
  const state = [], effects = [];
  const instance = { account, state, run(mount = false) {
    let index = 0;
    global.window = { location: { search: `?account=${account}` },
      addEventListener: (name, fn) => listeners.set(instance, fn), removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
    React.useState = initial => {
      const i = index++;
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }];
    };
    React.useEffect = fn => { if (mount) effects.push(fn); };
    let tree;
    try { tree = SequentialDemo(); if (mount) effects.forEach(fn => fn()); }
    finally { React.useState = originals.useState; React.useEffect = originals.useEffect; }
    return tree;
  } };
  instance.run(true);
  return instance;
}
function findAccount(tree) {
  if (!tree || typeof tree !== 'object') return;
  if (tree.type === AccountDemo) return tree;
  const children = React.Children.toArray(tree.props?.children);
  for (const child of children) { const found = findAccount(child); if (found) return found; }
}
try {
  const tabA = tab('DEMO-A'), tabB = tab('DEMO-B');
  const oldB = findAccount(tabB.run());
  findAccount(tabA.run()).props.onStamp('DEMO-A', 'actualStartTime');
  const aStart = segmentOf(JSON.parse(data.get(key)).services[0].staffList[0]).actualStartTime;
  assert.ok(aStart);
  // A B handler rendered before A's write must read the latest storage before its own write.
  oldB.props.onStamp('DEMO-B', 'actualStartTime');
  const latest = JSON.parse(data.get(key));
  assert.equal(segmentOf(latest.services[0].staffList[0]).actualStartTime, aStart);
  assert.ok(segmentOf(latest.services[0].staffList[1]).actualStartTime);
  listeners.get(tabA)({ key }); listeners.get(tabB)({ key });
  assert.deepEqual(tabA.state[0], latest);
  assert.deepEqual(tabB.state[0], latest);
  const restoredB = tab('DEMO-B');
  assert.equal(findAccount(restoredB.run()).props.employeeId, 'DEMO-B');
  assert.equal(demoAccountState(restoredB.state[0].services[0], 'DEMO-B', Date.now()).segment.startTime, '10:45');
} finally {
  global.window = originals.window; global.localStorage = originals.localStorage;
  React.useState = originals.useState; React.useEffect = originals.useEffect;
}
console.log('PASS 5/5: Hai tab đồng bộ localStorage, handler cũ không xóa mốc của người kia, reload giữ đúng tài khoản/giờ');

const removedString = structuredClone(fixture().services[0]);
removedString.staffList[1].segments[0].voided = 'true';
assert.equal(demoAccountState(removedString, 'DEMO-B', at('11:00')).assigned, false);
assert.ok(renderAccount(removedString, 'DEMO-B').includes('Chưa có phân công'));
removedString.staffList[1].segments = [];
assert.equal(demoAccountState(removedString, 'DEMO-B', at('11:00')).assigned, false);
assert.ok(renderAccount(removedString, 'DEMO-B').includes('Chưa có phân công'));
const renamedCommon = fixture().services[0];
renamedCommon.options = { sequentialSlots: 2, displayName: 'Tên chung mới', _generatedDisplayName: 'Tên cũ' };
assert.ok(renderAccount(renamedCommon, 'DEMO-B').includes('Tên chung mới'));
assert.ok(!renderAccount(renamedCommon, 'DEMO-B').includes('Tên cũ'));
renamedCommon.options.serviceNamesForKtvs = { 'demo-b': 'Tên B riêng' };
assert.ok(renderAccount(renamedCommon, 'DEMO-B').includes('Tên B riêng'));
console.log('PASS demo guards/title: string voided and empty rows unassigned; common and own names use shared latest fallback');
