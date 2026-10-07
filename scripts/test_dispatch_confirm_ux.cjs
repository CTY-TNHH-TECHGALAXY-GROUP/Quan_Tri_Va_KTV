const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: path.join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const React = require('react');
const Dialog = require('@radix-ui/react-dialog');
const { DispatchConfirmModal } = require('../app/reception/dispatch/_components/DispatchConfirmModal');
const states = [], refs = [];
let closed = 0, confirmed = 0, stateIndex, refIndex;
let confirm = () => true;
const service = { id: 'svc', serviceName: 'Test', duration: 60, min_ktv_required: 1,
  staffList: [{ ktvId: 'A', segments: [{ id: 'a', ktvId: 'A', roomId: 'R', bedId: 'X', startTime: '10:00', endTime: '11:00', duration: 60 }] }] };
const order = { id: 'booking', billCode: 'TEST', services: [service] };
function elements(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [ ...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap(n => elements(n, predicate)) ];
}
function render(pending = false) {
  stateIndex = refIndex = 0;
  const useState = React.useState, useRef = React.useRef;
  React.useState = initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; };
  React.useRef = initial => { const i = refIndex++; return refs[i] ||= { current: initial }; };
  try { return DispatchConfirmModal({ open: true, pending, order, subOrder: { services: [service], originalOrder: order }, rooms: [], beds: [],
    onConfirm: async (...args) => { confirmed++; return await confirm(...args); }, onClose: () => { closed++; } }); }
  finally { React.useState = useState; React.useRef = useRef; }
}
const confirmButton = tree => elements(tree, e => e.type === 'button' && e.props.onClick?.constructor.name === 'AsyncFunction')[0];
(async () => {
  let tree = render();
  assert.equal(elements(tree, e => e.type === Dialog.Content).length, 1, 'installed dialog provides semantic role/focus trap');
  assert.equal(elements(tree, e => e.type === Dialog.Title).length, 1);
  const content = elements(tree, e => e.type === Dialog.Content)[0];
  global.HTMLElement = class HTMLElement {};
  const opener = new HTMLElement(); let focused = 0; opener.focus = () => focused++;
  global.document = { activeElement: opener };
  content.props.onOpenAutoFocus();
  content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(focused, 1, 'close restores actual opener without Dialog.Trigger');
  let resolve;
  confirm = () => new Promise(r => { resolve = r; });
  const promise = confirmButton(tree).props.onClick();
  await confirmButton(tree).props.onClick();
  assert.equal(confirmed, 1, 'duplicate click rejected synchronously');
  assert.equal(closed, 0, 'modal remains open until result');
  tree = render(); assert.equal(confirmButton(tree).props.disabled, true);
  let prevented = 0;
  elements(tree, e => e.type === Dialog.Content)[0].props.onEscapeKeyDown({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1, 'Escape cannot dismiss during commit');
  resolve(false); await promise; assert.equal(closed, 0, 'handled failure/cancel preserves dialog');
  confirm = () => { throw Error('Retryable error'); };
  await confirmButton(render()).props.onClick();
  tree = render(); assert.equal(closed, 0);
  assert.ok(elements(tree, e => e.props?.role === 'alert').some(e => e.props.children === 'Retryable error'));
  confirm = () => true;
  await confirmButton(render()).props.onClick(); assert.equal(closed, 1);
  tree = render(true); assert.equal(confirmButton(tree).props.disabled, true, 'parent pending guards shared commit');
  service.staffList[0].segments[0].voided = true;
  tree = render(); assert.equal(confirmButton(tree).props.disabled, true, 'historical employee cannot satisfy readiness');
  console.log('PASS CONFIRM UX: dialog/focus restore, pending/duplicate guard, cancel/error retention, success close and active validation');
})().catch(error => { console.error(error); process.exitCode = 1; });
