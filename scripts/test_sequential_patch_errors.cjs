const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const { NextResponse } = require('next/server');
const source = readFileSync(join(__dirname, '../app/api/ktv/booking/route.ts'), 'utf8');
const compiled = ts.transpileModule(source.slice(source.indexOf('export async function PATCH(')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function scenario(failure) {
 let handlerCalls = 0, bookingWrites = 0, released = 0, safetyReads = 0;
 const atomic = failure === 'atomic' || failure === 'atomic-release';
 const atomicData = { id: 'booking', status: 'IN_PROGRESS', updatedAt: 'atomic timestamp' };
 const db = { from(table) {
  let write = false, sharedItems = false;
  const query = {
   select(fields) { if (table === 'BookingItems') sharedItems = fields.includes('technicianCodes'); return this; },
   update() { write = true; if (table === 'Bookings') bookingWrites++; return this; },
   eq() { return this; }, maybeSingle() { return Promise.resolve(result()); },
   then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); }
  };
  function result() {
   const phase = table === 'TurnQueue' ? 'turn-read' : table === 'BookingItems' ? (sharedItems ? 'items-read' : 'safety-read') : bookingWrites === 1 ? 'booking-write' : 'safety-write';
   if (phase === 'safety-read') safetyReads++;
   if (atomic && (phase === 'booking-write' || phase === 'safety-read' || phase === 'safety-write')) throw new Error('Must not write/recompute after atomic handler');
   if (failure === phase) return { data: null, error: { message: `Injected ${phase} failed` } };
   if (failure === `${phase}-throw`) throw new Error(`Injected ${phase} network`);
   if (failure === `${phase}-empty`) return { data: table === 'BookingItems' ? [] : null, error: null };
   if (table === 'TurnQueue') return { data: { booking_item_id: 'item' }, error: null };
   if (table === 'BookingItems') return { data: sharedItems ? [{ id: 'item', technicianCodes: ['B'], guest_id: 'g' }] : [{ status: 'IN_PROGRESS', serviceId: 'service' }], error: null };
   return { data: { id: 'booking', status: 'CLEANING' }, error: null };
  }
  return query;
 } };
 const exportsStub = {};
 const fn = new Function('exports', 'NextResponse', 'getSupabaseAdmin', 'KtvBookingPatchSchema', 'getBusinessDateFromConfig', 'handleStartTimer', 'handleFinishService', 'handleReleaseKTV', 'isUtilityService', 'require', compiled);
 fn(exportsStub, NextResponse, () => db, { safeParse: body => ({ success: true, data: body }) }, async () => '2026-09-26', async () => ({ bookingUpdatePayload: {} }), async () => {
  handlerCalls++;
  if (atomic) return { bookingUpdatePayload: { status: 'STALE_STATUS' }, bookingPersisted: true, bookingData: atomicData };
  if (failure === 'handler-early') return { bookingUpdatePayload: {}, earlyResponse: NextResponse.json({ success: false, error: 'Already saved a portion; reload.' }, { status: 500 }) };
  if (failure === 'handler-throw') throw new Error('Injected handler network');
  return { bookingUpdatePayload: { status: 'CLEANING' } };
 }, async () => { released++; return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: atomicData }; }, () => false, id => {
  assert.equal(id, '@/lib/dispatch-status'); return { recomputeBookingStatus: () => 'IN_PROGRESS' };
 });
 const response = await exportsStub.PATCH(new Request('http://localhost/api/ktv/booking', { method: 'PATCH', body: JSON.stringify({ bookingId: 'booking', techCode: 'B', status: 'CLEANING', ...(failure === 'atomic-release' ? { action: 'RELEASE_KTV' } : {}) }), headers: { 'Content-Type': 'application/json' } }));
 const body = await response.json();
 if (atomic) { assert.equal(response.status, 200); assert.equal(body.success, true); assert.deepEqual(body.data, atomicData); assert.equal(bookingWrites, 0); assert.equal(safetyReads, 0); assert.equal(handlerCalls, failure === 'atomic-release' ? 0 : 1); }
 else if (!failure) { assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(body.data.status, 'IN_PROGRESS'); assert.equal(bookingWrites, 2); }
 else {
  assert.ok(response.status >= 400, `${failure} must not report HTTP200`);
  assert.equal(body.success, false, `${failure} must not report successful completion`);
  assert.ok(body.error);
  if (failure.startsWith('turn-') || failure.startsWith('items-')) assert.equal(handlerCalls, 0);
  if (failure.startsWith('handler-') || failure.startsWith('turn-') || failure.startsWith('items-')) assert.equal(bookingWrites, 0);
 }
 assert.equal(released, failure === 'atomic-release' ? 1 : 0);
 console.log(`PASS PATCH ${failure || 'success'}: no false success, no later writes after failure`);
}
(async () => {
 for (const failure of ['turn-read', 'items-read', 'booking-write', 'booking-write-empty', 'safety-read', 'safety-read-empty', 'safety-write', 'safety-read-throw', 'safety-write-throw', 'handler-early', 'handler-throw', 'atomic', 'atomic-release', null]) await scenario(failure);
})().catch(error => { console.error(error); process.exitCode = 1; });
