/** Mô phỏng quyết định HANDOVER/REWARD của KTVDashboard.logic.ts (cũ vs mới) bằng helper thật. */
import { parseKtvSegments, isKtvDisplaySegment } from '@/lib/ktvUtils';
const decide = (booking: any, ktvId: string, onlyDone: boolean) => {
  const mySegs = booking.BookingItems.flatMap((i: any) => parseKtvSegments(i.segments)
    .filter((s: any) => isKtvDisplaySegment(s, ktvId) && (!onlyDone || (!!s.actualStartTime && !!s.actualEndTime))));
  let allHandover = mySegs.length > 0 && mySegs.every((s: any) => !!s.handoverTime);
  const myItemIds: string[] = booking.assignedItemIds || [];
  if (booking.BookingItems.some((i: any) => myItemIds.includes(i.id) && ['SKIPPED', 'REJECTED'].includes(String(i.handover_status || '').toUpperCase()))) allHandover = false;
  return allHandover ? 'REWARD' : 'HANDOVER';
};
const T = '2026-10-01T17:00:00Z';
const seg = (ktvId: string, o: any = {}) => ({ id: Math.random().toString(36).slice(2), ktvId, ...o });
const done = { actualStartTime: T, actualEndTime: T }, ho = { ...done, handoverTime: T };
const cases: [string, any, string][] = [
  ['1KTV-1DV xong, chưa bàn giao', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', segments: [seg('K', done)] }] }, 'HANDOVER'],
  ['1KTV-1DV đã bàn giao', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', segments: [seg('K', ho)] }] }, 'REWARD'],
  ['1KTV-2DV không gộp: DV1 xong chưa bàn giao, DV2 chưa làm', { assignedItemIds: ['I1', 'I2'], BookingItems: [{ id: 'I1', segments: [seg('K', done)] }, { id: 'I2', segments: [seg('K')] }] }, 'HANDOVER'],
  ['1KTV-2DV không gộp: DV1 đã bàn giao, DV2 chưa làm', { assignedItemIds: ['I1', 'I2'], BookingItems: [{ id: 'I1', segments: [seg('K', ho)] }, { id: 'I2', segments: [seg('K')] }] }, 'REWARD'],
  ['1KTV-2DV: DV1 bàn giao, DV2 làm xong chưa bàn giao', { assignedItemIds: ['I1', 'I2'], BookingItems: [{ id: 'I1', segments: [seg('K', ho)] }, { id: 'I2', segments: [seg('K', done)] }] }, 'HANDOVER'],
  ['1KTV-2DV gộp: 2 chặng xong, 1 chặng thiếu bàn giao', { assignedItemIds: ['I1', 'I2'], BookingItems: [{ id: 'I1', segments: [seg('K', ho)] }, { id: 'I2', segments: [seg('K', done)] }] }, 'HANDOVER'],
  ['B9: I1 đã bàn giao + lượt B của I2 chưa làm', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', segments: [seg('K', ho)] }, { id: 'I2', segments: [seg('C', ho), seg('K', { sequenceSlot: 2 })] }] }, 'REWARD'],
  ['Nợ bàn giao (SKIPPED) dù có handoverTime', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', handover_status: 'SKIPPED', segments: [seg('K', ho)] }] }, 'HANDOVER'],
  ['Quầy trả lại (REJECTED)', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', handover_status: 'REJECTED', segments: [seg('K', ho)] }] }, 'HANDOVER'],
  ['2KTV-1DV: K xong đã bàn giao, KTV kia chưa', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', segments: [seg('K', ho), seg('X', done)] }] }, 'REWARD'],
  ['Huỷ không công (CANCELLED_NO_CREDIT) đã làm, chưa bàn giao', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', segments: [seg('K', { ...done, voided: true, note: 'CANCELLED_NO_CREDIT' })] }] }, 'HANDOVER'],
  ['Chặng đã bị void (đổi ra/bỏ phân công) không tính', { assignedItemIds: ['I1'], BookingItems: [{ id: 'I1', segments: [seg('K', ho), seg('K', { voided: true, note: 'UNASSIGNED' })] }] }, 'REWARD'],
];
let fail = 0;
for (const [name, b, want] of cases) { const oldR = decide(b, 'K', false), newR = decide(b, 'K', true); const ok = newR === want; if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} → mới ${newR} | cũ ${oldR}${oldR !== newR ? '  ◀ đổi' : ''}`); }
console.log(JSON.stringify({ passed: cases.length - fail, failed: fail })); if (fail) process.exitCode = 1;
