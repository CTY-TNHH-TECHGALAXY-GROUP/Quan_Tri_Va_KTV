const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const { parseKtvOptions, ktvServiceName, isLiveKtvSegment, ktvAssignedMinutes, parseKtvSegments } = require('../lib/ktvUtils');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let rejectServices;
const modalPath = require.resolve('../app/ktv/dashboard/_components/modals');
require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true, exports: Object.fromEntries(['ProcedureModal', 'RoomIssueModal', 'RejectOrderModal', 'TurnQueueTypeDModal', 'OfficeScoreModal'].map(name => [name, props => { if (name === 'RejectOrderModal') rejectServices = props.services; return null; }])) };
const reminderPath = require.resolve('../app/ktv/dashboard/_components/CheckInReminder');
require.cache[reminderPath] = { id: reminderPath, filename: reminderPath, loaded: true, exports: { CheckInReminder: () => null } };
const { ScreenTimer } = require('../app/ktv/dashboard/_screens/ScreenTimer');
const { ScreenDashboard } = require('../app/ktv/dashboard/_screens/ScreenDashboard');
const { ToastProvider } = require('../components/ui/Toast');
const options = { sequentialSlots: 2, serviceNamesForKtvs: { A: 'Tên A riêng', b: 'Tên B mới' } };
for (const raw of [options, JSON.stringify(options), JSON.stringify(JSON.stringify(options))]) {
  assert.deepEqual(parseKtvOptions(raw), options);
  assert.equal(ktvServiceName({ options: raw, base_service_name: 'Tên gốc' }, 'B'), 'Tên B mới');
  assert.equal(ktvServiceName({ options: raw, base_service_name: 'Tên gốc' }, 'A'), 'Tên A riêng');
}
for (const raw of [null, 'broken', 'null', '[]', []]) assert.deepEqual(parseKtvOptions(raw), {});
assert.equal(ktvServiceName({ options: { serviceNamesForKtvs: { B: '' } }, base_service_name: 'Tên gốc', service_name: 'Tên B cache cũ' }, 'B'), 'Tên gốc');
assert.equal(ktvServiceName({ options: { _generatedDisplayName: 'Massage (60p)', displayName: 'Gói mới', serviceNamesForKtvs: { B: '' } }, base_service_name: 'Massage' }, 'B'), 'Gói mới');
console.log('PASS options object/JSON/double JSON/malformed, own names and cleared override');
const segments = [
 { id: 'a', ktvId: 'A', sequenceSlot: 1, startTime: '10:00', endTime: '10:30', duration: 30 },
 { id: 'b-old', ktvId: 'B', sequenceSlot: 2, startTime: '10:30', endTime: '11:00', duration: 30, voided: true },
 { id: 'c-old', ktvId: 'C', sequenceSlot: 2, startTime: '10:35', endTime: '11:05', duration: 30, voided: true },
 { id: 'b-new', ktvId: 'B', sequenceSlot: 2, startTime: '11:10', endTime: '11:25', duration: 15 },
];
assert.deepEqual(segments.filter(s => isLiveKtvSegment(s, 'B')).map(s => s.id), ['b-new']);
assert.ok(isLiveKtvSegment({ ktvId: 'A - B' }, 'b'));
const item = { id: 'item', duration: 60, status: 'PREPARING', options: JSON.stringify(JSON.stringify(options)), base_service_name: 'Tên gốc', service_name: 'Tên cache cũ', segments };
for (const Screen of [ScreenDashboard, ScreenTimer]) {
 const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(Screen, { logic: {
  ktvId: 'B', activeSegmentIndex: 0, timeRemaining: 900, prepTimeRemaining: 0, prepProcedure: [], checklist: [], turnData: {}, pendingHandovers: [], settings: {},
  booking: { id: 'booking', acceptedAt: '2026-09-26T03:00:00Z', assignedItemIds: ['item'], assignedItemId: 'item', status: 'PREPARING', BookingItems: [item] }
 } })));
 assert.ok(html.includes('Tên B mới') && html.includes('11:10') && html.includes('11:25'));
 assert.ok(!html.includes('10:30') && !html.includes('10:35') && !html.includes('Tên A riêng'));
}
console.log('PASS real Dashboard/Timer B → C → B select new slot and latest own title');
const split90 = { id:'split90',duration:90,status:'PREPARING',options:{sequentialSlots:2},base_service_name:'Ráy tai - Cổ vai gáy - Body',segments:[
  {id:'slot-a',ktvId:'T016',sequenceSlot:1,startTime:'15:20',endTime:'16:05',duration:45},
  {id:'slot-b',ktvId:'NH018',sequenceSlot:2,startTime:'16:05',endTime:'16:50',duration:45}
] };
assert.equal(ktvAssignedMinutes(split90,'NH018'),45);
assert.equal(ktvAssignedMinutes(split90,'T016'),45);
assert.equal(ktvAssignedMinutes(split90,'NO-ASSIGNMENT'),0);
assert.equal(ktvAssignedMinutes({...split90,segments:[]},'NH018'),90);
assert.equal(ktvAssignedMinutes({...split90,segments:[{ktvId:'NH018',duration:0}]},'NH018'),0);
const getSource = readFileSync(join(__dirname,'../app/api/ktv/booking/_handlers/handleGetBooking.ts'),'utf8');
const durationBody = getSource.slice(getSource.indexOf('let finalDuration ='),getSource.indexOf('const getI18nStr'));
const getDuration = new Function('svc','opts','sId','i','technicianCode','ktvAssignedMinutes',durationBody+'return finalDuration;');
assert.equal(getDuration({duration:90},{duration:90},'nhs1006',split90,'NH018',ktvAssignedMinutes),45);
for (const Screen of [ScreenDashboard,ScreenTimer]) {
 const html = renderToStaticMarkup(React.createElement(ToastProvider,null,React.createElement(Screen,{logic:{
  ktvId:'NH018',activeSegmentIndex:0,timeRemaining:2700,prepTimeRemaining:0,prepProcedure:[],checklist:[],turnData:{},pendingHandovers:[],settings:{},
  booking:{id:'11NDK-004-26092026',acceptedAt:'2026-09-26T08:20:00Z',assignedItemIds:['split90'],assignedItemId:'split90',status:'PREPARING',BookingItems:[split90]}
 }})));
 assert.ok(html.includes('45') && html.includes('16:05') && html.includes('16:50'));
 assert.ok(!html.includes('90 phút') && !html.includes('17:35'));
}
assert.equal(rejectServices.find(service=>service.id==='split90').minutes,45);
console.log('PASS 90-minute package split 45/45: actual API duration block, Dashboard/Timer and rejection choices use NH018 own 45 minutes');
const logicSource = readFileSync(join(__dirname, '../app/ktv/dashboard/KTVDashboard.logic.ts'), 'utf8');
const realtimeStart = logicSource.indexOf('const currentBooking = bookingRef.current;', logicSource.indexOf("table: 'BookingItems'"));
const realtimeEnd = logicSource.indexOf('\n            })', realtimeStart);
const realtimeCode = ts.transpileModule(logicSource.slice(realtimeStart, realtimeEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const screen of ['TIMER', 'REVIEW', 'HANDOVER', 'REWARD']) {
 let current = { id: 'booking', BookingItems: [structuredClone(item)] }, fetches = 0;
 const callback = new Function('payload', 'bookingRef', 'screenRef', 'isTransitioningRef', 'setBooking', 'ktvServiceName', 'ktvId', 'scheduleRealtimeFetch', realtimeCode);
 callback({ eventType: 'UPDATE', new: { id: 'item', bookingId: 'booking', options: JSON.stringify({ serviceNamesForKtvs: { B: 'Tên realtime' } }) } }, { current }, { current: screen }, { current: false }, fn => current = fn(current), ktvServiceName, 'B', () => fetches++);
 assert.equal(current.BookingItems[0].service_name, 'Tên realtime');
 callback({ eventType: 'UPDATE', new: { id: 'item', bookingId: 'booking', options: {} } }, { current }, { current: screen }, { current: false }, fn => current = fn(current), ktvServiceName, 'B', () => fetches++);
 assert.equal(current.BookingItems[0].service_name, 'Tên gốc');
 if (screen !== 'TIMER') assert.equal(fetches, 0);
}
console.log('PASS actual realtime callback refreshes/clears title in TIMER and post-service screens without navigation');
const finishCode = ts.transpileModule(logicSource.slice(logicSource.indexOf('const handleFinishTimer = async () => {'), logicSource.indexOf('// Keep ref up-to-date so timer callback')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nreturn handleFinishTimer;';
async function checkFinishFailure(mode) {
 const state = { loading: false, screen: 'TIMER', running: true, refresh: 0, toast: [] }, transitioning = { current: false }, post = { current: null };
 const names = ['booking','ktvId','isLiveKtvSegment','activeSegmentIndex','setIsLoading','apiClient','API','setActiveSegmentIndex','activeSegmentIndexRef','manualSegmentOverrideRef','setTimeRemaining','fetchBookingRef','isTransitioningRef','postServiceBookingIdRef','localStorage','POST_SERVICE_BOOKING_KEY','addToast','supabase','setIsTimerRunning','setScreen'];
 const fn = new Function(...names, finishCode)(
 { id: 'booking', assignedItemIds: ['item'], BookingItems: [{ id: 'item', segments: [segments[3]] }] }, 'B', isLiveKtvSegment, 0,
 value => state.loading = value, { async patch() { if (mode === 'response') return { success: false, error: 'UPDATE failed' }; throw new Error(mode); } }, { KTV: { BOOKING: '/stub' } }, () => {}, { current: 0 }, { current: false }, () => {}, { current: () => state.refresh++ }, transitioning, post,
 { setItem() {}, removeItem() {} }, 'post', msg => state.toast.push(msg), { channel() { throw new Error('must not broadcast'); } }, value => state.running = value, value => state.screen = value);
 await fn();
 assert.equal(state.loading, false); assert.equal(transitioning.current, false); assert.equal(post.current, null);
 assert.equal(state.screen, 'TIMER'); assert.equal(state.running, true); assert.equal(state.refresh, 1); assert.equal(state.toast.length, 1);
}
(async () => { for (const mode of ['HTTP 500', 'Network disconnected', 'response']) await checkFinishFailure(mode); console.log('PASS actual finish handler catches HTTP/network/failed response, unlocks, refreshes and keeps timer'); })().catch(error => { console.error(error); process.exitCode = 1; });

const rejectSource = readFileSync(join(__dirname,'../app/api/ktv/discipline/reject-order/route.ts'),'utf8');
const rejectDurationBody = rejectSource.slice(rejectSource.indexOf('const segments = parseKtvSegments'),rejectSource.indexOf("const { getBusinessToday }"));
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const rejectDuration = new AsyncFunction('item','staffId','supabase','parseKtvSegments','isLiveKtvSegment','ktvAssignedMinutes','NextResponse',rejectDurationBody+'return mins;');
(async()=>{
 const noCatalogue = {from(){throw Error('A populated slot must never query catalogue minutes');}};
 const response = {json:(data,options)=>({data,status:options.status})};
 assert.equal(await rejectDuration(split90,'NH018',noCatalogue,parseKtvSegments,isLiveKtvSegment,ktvAssignedMinutes,response),45);
 const stale = await rejectDuration({...split90,segments:split90.segments.map(seg=>seg.ktvId==='NH018'?{...seg,voided:true}:seg)},'NH018',noCatalogue,parseKtvSegments,isLiveKtvSegment,ktvAssignedMinutes,response);
 assert.equal(stale.status,409);
 const zero = await rejectDuration({...split90,segments:[{ktvId:'NH018',duration:0}]},'NH018',noCatalogue,parseKtvSegments,isLiveKtvSegment,ktvAssignedMinutes,response);
 assert.equal(zero.status,409);
 console.log('PASS rejection backend uses own 45-minute allocation; replaced/zero-duration slot cannot be charged catalogue 90');
})().catch(error=>{console.error(error);process.exitCode=1;});
