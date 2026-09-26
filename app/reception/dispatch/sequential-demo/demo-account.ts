import { isTwoSlotSequential, sequentialSlotsComplete } from '@/lib/dispatch-status';
import { isLiveKtvSegment } from '@/lib/ktvUtils';
import { workedMsOf } from '@/lib/segment-time';
import type { ServiceBlock, WorkSegment } from '../types';

export type DemoSegment = WorkSegment & { ktvId: string; voided?: boolean; plannedStartAt?: string; plannedEndAt?: string };
export const segmentOf = (row: ServiceBlock['staffList'][number]) => (row.segments.find(seg => (seg as any).voided !== true && (seg as any).voided !== 'true') || row.segments[0]) as DemoSegment;
export const segmentsOf = (service: ServiceBlock) => service.staffList.flatMap(row => row.segments.map(segment => ({ ...segment, ktvId: row.ktvId })));

export function demoAccountState(service: ServiceBlock, employeeId: string, now: number) {
  const row = service.staffList.find(person => !!segmentOf(person) && isLiveKtvSegment({ ...segmentOf(person), ktvId: person.ktvId }, employeeId));
  const segment = row && segmentOf(row);
  const assigned = service.status !== 'NEW' && service.status !== 'WAITING' && !!segment;
  const elapsedMs = assigned && segment ? workedMsOf(segment, segment.actualEndTime || now) ?? 0 : 0;
  const canWork = assigned && ['PREPARING', 'READY', 'IN_PROGRESS'].includes(service.status || '');
  const canStart = canWork && !segment?.actualStartTime && !segment?.actualEndTime
    && !service.options?.finishedAfterA;
  return { row, segment, assigned, elapsedMs,
    remainingMs: Math.max(0, (segment?.duration || 0) * 60_000 - elapsedMs),
    canStart: !!canStart, canFinish: !!(canWork && segment?.actualStartTime && !segment.actualEndTime) };
}

/** Stamp only this employee's segment. Never inherit another employee's actual time. */
export function stampDemoAccount(service: ServiceBlock, employeeId: string, field: 'actualStartTime' | 'actualEndTime', now = Date.now()): string | undefined {
  const state = demoAccountState(service, employeeId, now);
  if (!(field === 'actualStartTime' ? state.canStart : state.canFinish)) {
    return 'Phân công đã thay đổi hoặc lượt này đã kết thúc.';
  }
  const segment = state.segment!;
  const previous = field === 'actualEndTime' ? segment.actualStartTime : undefined;
  if (!Number.isFinite(now) || (previous && (!Number.isFinite(Date.parse(previous)) || now < Date.parse(previous)))) {
    return 'Giờ hiện tại không hợp lệ hoặc đang trước mốc thực đã ghi. Kiểm tra đồng hồ máy.';
  }
  segment[field] = new Date(now).toISOString();
  if (field === 'actualStartTime') service.status = 'IN_PROGRESS';
  if (field === 'actualEndTime' && (isTwoSlotSequential(service.options)
    ? sequentialSlotsComplete(service.options, segmentsOf(service)) : !!segment.actualEndTime)) service.status = 'CLEANING';
}
