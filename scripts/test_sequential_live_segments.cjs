const assert = require('node:assert/strict');
const { join } = require('node:path');
require('ts-node').register({ project: join(__dirname, 'qa/tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..'), paths: { '@/*': ['./*'] } });
const { isLiveKtvSegment } = require('../lib/ktvUtils');
const { handleStartTimer } = require('../app/api/ktv/booking/_handlers/handleStartTimer');

const segments = [
  { id: 'a', ktvId: 'A', sequenceSlot: 1, startTime: '10:00', duration: 30 },
  { id: 'old-b', ktvId: 'B', sequenceSlot: 2, startTime: '10:30', duration: 30, voided: true },
  { id: 'old-c', ktvId: 'C', sequenceSlot: 2, startTime: '10:40', duration: 20, voided: true },
  { id: 'new-b', ktvId: 'B', sequenceSlot: 2, startTime: '10:50', duration: 10 },
];
assert.deepEqual(segments.filter(s => isLiveKtvSegment(s, 'b')).map(s => s.id), ['new-b']);
assert.equal(isLiveKtvSegment({ ktvId: 'B - C' }, ' b '), true);
assert.equal(isLiveKtvSegment({ ktvId: 'B', voided: 'true' }, 'B'), false);
assert.equal(isLiveKtvSegment(null, 'B'), false);
let saved;
function query(table) {
  let update;
  const q = {
    select() { return q; }, eq() { return q; }, in() { return q; },
    update(value) { update = value; return q; },
    single() { return Promise.resolve({ data: { timeStart: '2026-09-26T03:00:00Z', status: 'IN_PROGRESS' } }); },
    then(resolve, reject) {
      if (update) saved = JSON.parse(update.segments);
      return Promise.resolve({ data: update ? null : table === 'BookingItems' ? [{ id: 'item', segments: JSON.stringify(segments), options: { sequentialSlots: 2 } }] : [], error: null }).then(resolve, reject);
    },
  };
  return q;
}
const supabase = { from: query, storage: { from: () => ({
  async upload(path) { return { data: { path } }; },
  getPublicUrl(path) { return { data: { publicUrl: `https://local.test/${path}` } }; },
  async remove() { return { error: null }; },
}) } };
const proof = 'data:image/jpeg;base64,/9j/';
(async () => {
  const ctx = { supabase, bookingId: 'order', technicianCode: 'B', action: 'START_TIMER', turnForSync: null,
    allItemIdsForThisKTV: ['item'], body: { activeSegmentIndex: 0, startPhotoBase64: proof, guestSlipperPhotoBase64: proof } };
  const result = await handleStartTimer(ctx);
  assert.equal(result.earlyResponse, undefined);
  assert.deepEqual(saved.slice(0, 3), segments.slice(0, 3));
  assert.ok(saved[3].actualStartTime);
  assert.ok(saved[3].startPhotoUrl);
  assert.equal(saved.filter(s => isLiveKtvSegment(s, 'B')).reduce((n, s) => n + s.duration, 0), 10);
  saved = undefined;
  const removed = await handleStartTimer({ ...ctx, technicianCode: 'C' });
  assert.equal(removed.earlyResponse.status, 409);
  assert.equal(saved, undefined);
  console.log('PASS: B → C → B START targets current B, keeps history/A intact, excludes old duration; replaced C cannot start.');
})().catch(error => { console.error(error); process.exitCode = 1; });
