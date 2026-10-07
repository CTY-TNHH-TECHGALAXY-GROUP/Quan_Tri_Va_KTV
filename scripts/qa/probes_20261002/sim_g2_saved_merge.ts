/** G2: form sau khi lưu "bỏ B" có dựng lại hàng B (chặng void) không, và lần lưu kế tiếp gửi gì. */
import { mergeSavedDispatchForm, dispatchFormSignature } from '@/lib/dispatch-form-draft';
const A = { id: 'S1', ktvId: 'A', roomId: 'R', bedId: 'D', startTime: '10:00', endTime: '10:45', duration: 45, sequenceSlot: 1 };
const Bv = { id: 'S2', ktvId: 'B', roomId: 'R', bedId: 'D', startTime: '10:40', endTime: '11:10', duration: 30, sequenceSlot: 2, voided: true, note: 'UNASSIGNED' };
const submitted: any = { id: 'I1', serviceName: 'DV', duration: 75, status: 'PREPARING', options: { sequentialSlots: 2, dispatchRevision: 2 },
  staffList: [{ id: 'st-I1-A', ktvId: 'A', ktvName: 'A', segments: [A] }] };
const saved = { id: 'I1', status: 'PREPARING', roomName: 'R', bedId: 'D', technicianCodes: ['A'], segments: [A, Bv], options: { sequentialSlots: 2, dispatchRevision: 5 } };
const merged = mergeSavedDispatchForm(submitted, submitted, saved);
console.log('staffList sau khi lưu:', merged.staffList.map((r: any) => `${r.ktvId}[${r.segments.map((s: any) => s.id + (s.voided ? '(void)' : '')).join(',')}]`).join(' | '));
console.log('revision trong form:', merged.options.dispatchRevision);
console.log('signature đổi so với bản gửi:', dispatchFormSignature(merged) !== dispatchFormSignature(submitted));
const legacy = mergeSavedDispatchForm(submitted, submitted, { ...saved, technicianCodes: undefined });
console.log('không có technicianCodes (dự phòng):', legacy.staffList.map((r: any) => r.ktvId).join(','));
const ok = merged.staffList.length === 1 && merged.staffList[0].ktvId === 'A' && legacy.staffList.map((r: any) => r.ktvId).join(',') === 'A';
console.log(ok ? 'PASS không còn hàng B ma' : 'FAIL'); if (!ok) process.exitCode = 1;
const swapped = mergeSavedDispatchForm(submitted, submitted, { ...saved, segments: [A, { ...Bv, sequenceSlot: 1, actualStartTime: '2026-10-01T10:00:00Z', actualEndTime: '2026-10-01T10:05:00Z', note: 'SWAPPED' }] });
const ok2 = swapped.staffList.map((r: any) => r.ktvId).join(',') === 'A,B';
console.log(ok2 ? 'PASS KTV bị đổi ra (đã làm) vẫn giữ hàng' : 'FAIL swapped', swapped.staffList.map((r: any) => r.ktvId)); if (!ok2) process.exitCode = 1;
