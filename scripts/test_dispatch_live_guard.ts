import assert from 'node:assert/strict';
import { liveDispatchConflict, savedPlanFields } from '../lib/dispatch-live-guard';
import { suggestedHandoffMinutes, remainingHandoffMinutes, plannedHandoffStartAt } from '../lib/dispatch-handoff';
import { sequentialSlotsComplete } from '../lib/dispatch-status';
import { buildOrderTimeline } from '../app/reception/dispatch/_components/dispatch-timeline';

const a = { id: 'a', ktvId: 'T001', startTime: '10:00', endTime: '11:00', duration: 60,
    actualStartTime: '2026-09-25T03:00:00Z' };
assert.equal(suggestedHandoffMinutes(60, a, Date.parse('2026-09-25T03:40:00Z')), 20);
const finishedA = { ...a, actualEndTime: '2026-09-25T03:30:00Z' };
assert.equal(suggestedHandoffMinutes(60, finishedA, Date.parse('2026-09-25T04:40:00Z')), 30);
assert.equal(suggestedHandoffMinutes(60, { ...finishedA, pauses: [{ from: '2026-09-25T03:10:00Z', to: '2026-09-25T03:20:00Z' }] }, Date.parse('2026-09-25T04:40:00Z')), 40);
assert.equal(suggestedHandoffMinutes(60, { ...a, pauses: [
    { from: '2026-09-25T03:10:00Z', to: '2026-09-25T03:20:00Z' },
] }, Date.parse('2026-09-25T03:40:00Z')), 30);
assert.equal(liveDispatchConflict([a], [{ ...a, duration: 30 },
    { id: 'b', ktvId: 'T002', duration: 30 }]) !== null, true);
assert.equal(liveDispatchConflict([a], [{ ...a, roomId: 'R2' }]), null);
const slotA = { ...a, sequenceSlot: 1 };
const slotB = { id: 'b', ktvId: 'T002', sequenceSlot: 2, startTime: '10:40', endTime: '11:00', duration: 20 };
const twoSlots = { sequentialSlots: 2 };
assert.equal(remainingHandoffMinutes(60, 30), 30);
assert.equal(remainingHandoffMinutes(60, 45), 15);
assert.equal(remainingHandoffMinutes(60, 60), 0);
assert.equal(remainingHandoffMinutes(60, 90), 0);
assert.equal(plannedHandoffStartAt('2026-09-26', { startTime: '23:45', duration: 30 }), '2026-09-26T17:15:00.000Z');
assert.equal(plannedHandoffStartAt('2026-09-26', { ...a, actualEndTime: '2026-09-26T04:05:00Z' }), '2026-09-26T04:05:00.000Z');
assert.equal(plannedHandoffStartAt('2026-09-26', { startTime: '', duration: 30 }), '');
const draftA = { ...slotA, actualStartTime: undefined };
assert.equal(liveDispatchConflict([draftA], [{ ...draftA, duration: 30 }, slotB], twoSlots, twoSlots, 'NEW'), null);
assert.equal(liveDispatchConflict([draftA, slotB], [draftA], twoSlots, {}, 'WAITING'), null);
assert.ok(liveDispatchConflict([slotA], [{ ...slotA, duration: 30 }], twoSlots, twoSlots, 'NEW'));
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
const savedPlan = { startTime: '10:30', endTime: '11:00', duration: 30,
    plannedStartAt: '2026-09-26T03:30:00Z', plannedEndAt: '2026-09-26T04:00:00Z' };
assert.deepEqual(savedPlanFields(savedPlan, { ...savedPlan, plannedStartAt: 'old', plannedEndAt: undefined }),
    { plannedStartAt: savedPlan.plannedStartAt, plannedEndAt: savedPlan.plannedEndAt });
assert.deepEqual(savedPlanFields(savedPlan, { ...savedPlan, startTime: '10:45' }),
    { plannedStartAt: undefined, plannedEndAt: undefined });
console.log('dispatch live guard: OK');
