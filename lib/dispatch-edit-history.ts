import type { ServiceBlock } from '@/app/reception/dispatch/types';

export interface DispatchFieldChange {
  employeeId?: string | null;
  segmentId?: string;
  field: string;
  before: unknown;
  after: unknown;
}
export interface DispatchEditEntry {
  revision: number;
  at: string;
  action: string;
  actor: { id?: string | null; name?: string | null } | null;
  changes: DispatchFieldChange[];
}
export const dispatchRevision = (options: any): number => Number(options?.dispatchRevision ?? 0);
export const dispatchTimeFields = ['startTime', 'endTime', 'duration', 'plannedStartAt', 'plannedEndAt', 'actualStartTime', 'actualEndTime'] as const;

/** Local demo audit, with the same entry shape as the database trigger. */
export function recordDispatchEdit(before: ServiceBlock, after: ServiceBlock, action: string, actor: DispatchEditEntry['actor']): void {
  const oldSegments = before.staffList.flatMap(row => row.segments.map(segment => ({ ...segment, ktvId: row.ktvId })));
  const newSegments = after.staffList.flatMap(row => row.segments.map(segment => ({ ...segment, ktvId: row.ktvId })));
  const changes: DispatchFieldChange[] = [];
  for (const id of new Set([...oldSegments, ...newSegments].map(segment => segment.id))) {
    const oldSeg = oldSegments.find(segment => segment.id === id) as any;
    const newSeg = newSegments.find(segment => segment.id === id) as any;
    for (const field of ['ktvId', 'sequenceSlot', ...dispatchTimeFields, 'voided']) {
      if ((oldSeg?.[field] ?? null) !== (newSeg?.[field] ?? null)) changes.push({ segmentId: id,
        employeeId: newSeg?.ktvId || oldSeg?.ktvId || null, field, before: oldSeg?.[field] ?? null, after: newSeg?.[field] ?? null });
    }
  }
  const names = (service: ServiceBlock) => Object.fromEntries(service.staffList.filter(row => row.ktvId && row.serviceNameForKtv).map(row => [row.ktvId, row.serviceNameForKtv]));
  const oldNames = names(before), newNames = names(after);
  for (const id of new Set([...Object.keys(oldNames), ...Object.keys(newNames)])) {
    if ((oldNames[id] ?? null) !== (newNames[id] ?? null)) changes.push({ employeeId: id,
      field: 'serviceNameForKtv', before: oldNames[id] ?? null, after: newNames[id] ?? null });
  }
  if ((before.options?.displayName ?? null) !== (after.options?.displayName ?? null)) changes.push({ field: 'displayName', before: before.options?.displayName ?? null, after: after.options?.displayName ?? null });
  const previous = before.options?.dispatchHistory || [];
  const revision = dispatchRevision(before.options) + (changes.length || action === 'DISPATCH' ? 1 : 0);
  after.options = { ...after.options, dispatchRevision: revision, dispatchHistory: changes.length || action === 'DISPATCH'
    ? [...previous, { revision, at: new Date().toISOString(), action, actor, changes }] : previous };
}
