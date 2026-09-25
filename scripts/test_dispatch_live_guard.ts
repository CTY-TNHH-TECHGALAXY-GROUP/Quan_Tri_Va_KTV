import assert from 'node:assert/strict';
import { liveDispatchConflict } from '../lib/dispatch-live-guard';
import { suggestedHandoffMinutes } from '../lib/dispatch-handoff';
import { sequentialSlotsComplete } from '../lib/dispatch-status';
import { buildOrderTimeline } from '../app/reception/dispatch/_components/dispatch-timeline';

const a = { id: 'a', ktvId: 'T001', startTime: '10:00', endTime: '11:00', duration: 60,
    actualStartTime: '2026-09-25T03:00:00Z' };
assert.equal(suggestedHandoffMinutes(60, a, Date.parse('2026-09-25T03:40:00Z')), 20);
assert.equal(suggestedHandoffMinutes(60, { ...a, pauses: [
    { from: '2026-09-25T03:10:00Z', to: '2026-09-25T03:20:00Z' },
] }, Date.parse('2026-09-25T03:40:00Z')), 30);
assert.equal(liveDispatchConflict([a], [{ ...a, duration: 30 },
    { id: 'b', ktvId: 'T002', duration: 30 }]) !== null, true);
assert.equal(liveDispatchConflict([a], [{ ...a, roomId: 'R2' }]), null);
const slotA = { ...a, sequenceSlot: 1 };
const slotB = { id: 'b', ktvId: 'T002', sequenceSlot: 2, startTime: '10:40', endTime: '11:00', duration: 20 };
const twoSlots = { sequentialSlots: 2 };
assert.equal(liveDispatchConflict([slotA, slotB], [slotA, slotB], twoSlots, twoSlots), null);
assert.ok(liveDispatchConflict([slotA, slotB], [slotA], twoSlots, twoSlots));
assert.ok(liveDispatchConflict([slotA, slotB], [slotA, { ...slotB, sequenceSlot: 1 }], twoSlots, twoSlots));
assert.ok(liveDispatchConflict([slotA, slotB], [slotA, slotB], twoSlots, {}));
assert.equal(sequentialSlotsComplete(twoSlots, [{ ...slotA, actualEndTime: '2026-09-25T04:00:00Z' }]), false);
assert.equal(sequentialSlotsComplete(twoSlots, [{ ...slotA, actualEndTime: '2026-09-25T04:00:00Z' }, slotB]), false);
assert.equal(sequentialSlotsComplete(twoSlots, [{ ...slotA, actualEndTime: '2026-09-25T04:00:00Z' },
    { ...slotB, actualStartTime: '2026-09-25T03:50:00Z', actualEndTime: '2026-09-25T04:10:00Z' }]), true);
assert.equal(sequentialSlotsComplete({ ...twoSlots, finishedAfterA: true }, [{ ...slotA, actualEndTime: '2026-09-25T04:00:00Z' }]), true);
const service = (segments: any[]) => ({ id: 'item', serviceName: 'NHS', duration: 60, status: 'IN_PROGRESS',
    options: twoSlots, staffList: segments.map(s => ({ ktvId: s.ktvId, segments: [s] })) });
for (const segments of [[slotA], [slotA, slotB]]) {
    const cards = buildOrderTimeline([{ id: 'booking', dispatchStatus: 'IN_PROGRESS',
        services: [service(segments)] } as any]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].services.length, 1);
    assert.equal(cards[0].dispatchStatus, 'IN_PROGRESS');
}
assert.equal(suggestedHandoffMinutes(60, a, Date.parse('2026-09-25T04:01:00Z')), 0);
console.log('dispatch live guard: OK');
