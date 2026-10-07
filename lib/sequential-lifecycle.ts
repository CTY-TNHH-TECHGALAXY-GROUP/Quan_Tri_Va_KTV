import { isTwoSlotSequential, sequentialSlotsComplete } from '@/lib/dispatch-status';
import { isLiveKtvSegment, parseKtvOptions, parseKtvSegments } from '@/lib/ktvUtils';
import { closeOpenPause, gioDongHoVN, workedMsOf, voidSegment } from '@/lib/segment-time';

export type SequentialAction = 'PAUSE' | 'RESUME' | 'FINISH' | 'CANCEL' | 'SWAP';
export type SequentialRequest = {
  action: SequentialAction; targetSlots?: number[]; employeeId?: string;
  newKtvId?: string; assignedMins?: number; extraTimeMins?: number;
  reason?: string; cancelCredit?: 'NONE' | 'WORKED';
};
export const sequentialSlotClosed = (options: any, slot: number) =>
  (parseKtvOptions(options).closedSequentialSlots || []).includes(slot);

export function employeeIsPaused(item: any, employeeId?: string): boolean {
  if (!employeeId) return false;
  return parseKtvSegments(item?.segments || item?.staffList?.flatMap((row: any) =>
    row.segments.map((seg: any) => ({ ...seg, ktvId: row.ktvId }))) || []).some(seg =>
    isLiveKtvSegment(seg, employeeId) && seg.actualStartTime && !seg.actualEndTime
    && ((seg.pauses || []).some((p: any) => p.from && !p.to)
      || (item.status === 'PAUSED' && !!item.pauseStart && Date.parse(seg.actualStartTime) <= Date.parse(item.pauseStart))));
}

/** Same operation for the browser demo and the service-role atomic commit. */
export function applySequentialLifecycle(item: any, request: SequentialRequest, at = new Date().toISOString(),
  actor: { id?: string | null; name?: string | null; verified?: boolean } = {}) {
  if (!isTwoSlotSequential(item.options)) throw new Error('Dịch vụ không phải ca nối tiếp.');
  if (!(request.action === 'CANCEL' ? ['PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED', 'CLEANING', 'FEEDBACK'] : ['PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED']).includes(item.status)) throw new Error('Ca đã đóng hoặc chưa điều phối; tải lại đơn.');
  if (!Number.isFinite(Date.parse(at))) throw new Error('Mốc thao tác không hợp lệ.');
  const segments = structuredClone(parseKtvSegments(item.segments, true));
  const options = structuredClone(parseKtvOptions(item.options));
  const live = segments.filter(seg => seg.voided !== true && seg.voided !== 'true');
  const running = live.filter(seg => seg.actualStartTime && !seg.actualEndTime);
  const slots = request.targetSlots;
  const closed = new Set<number>(options.closedSequentialSlots || []);
  if (request.action === 'PAUSE' || request.action === 'RESUME') {
    if (!running.length || (request.employeeId && !running.some(seg => isLiveKtvSegment(seg, request.employeeId!))))
      throw new Error('Nhân viên này không có lượt đang làm để tạm dừng/tiếp tục.');
    if (request.action === 'RESUME' && item.status !== 'PAUSED') throw new Error('Ca chưa tạm dừng.');
    for (const seg of running) {
      seg.pauses ||= [];
      if (request.action === 'PAUSE') {
        if (!seg.pauses.some((p: any) => p.from && !p.to)) seg.pauses.push({ from: at });
      } else if (!closeOpenPause(seg, at, 'RESUME') && item.pauseStart && Date.parse(seg.actualStartTime) <= Date.parse(item.pauseStart)) {
        seg.pauses.push({ from: item.pauseStart, to: at, closedBy: 'RESUME' });
      }
    }
  } else {
    if (!slots?.length || slots.some(slot => ![1, 2].includes(slot)) || new Set(slots).size !== slots.length)
      throw new Error('Chọn A, B hoặc cả hai trước khi xác nhận.');
    const targets = live.filter(seg => slots.includes(Number(seg.sequenceSlot)) && (request.action === 'CANCEL' || !seg.actualEndTime));
    if (!targets.length && slots.every(slot => closed.has(slot) || live.some(seg => Number(seg.sequenceSlot) === slot && seg.actualEndTime)))
      throw new Error('Các lượt đã hoàn thành hoặc đã đóng; tải lại đơn.');
    if (request.action === 'SWAP') {
      if (slots.length !== 1 || targets.length !== 1 || !request.newKtvId || !request.reason?.trim())
        throw new Error('Chọn một nhân viên cần đổi, người thay thế và lý do.');
      if (running.length && item.status !== 'PAUSED') throw new Error('Tạm dừng trước khi đổi nhân viên đang làm.');
      if (live.some(seg => isLiveKtvSegment(seg, request.newKtvId!))) throw new Error('Người thay thế đã có trong ca.');
    }
    for (const seg of targets) {
      const open = (seg.pauses || []).find((p: any) => p.from && !p.to);
      const end = seg.actualEndTime || open?.from || (item.status === 'PAUSED' && item.pauseStart && seg.actualStartTime
        && Date.parse(seg.actualStartTime) <= Date.parse(item.pauseStart) ? item.pauseStart : at);
      if (seg.actualStartTime && Date.parse(end) < Date.parse(seg.actualStartTime)) throw new Error('Mốc kết thúc trước giờ bắt đầu.');
      closeOpenPause(seg, end, request.action === 'FINISH' ? 'FINISH' : request.action);
      if (seg.actualStartTime) {
        seg.actualEndTime = end;
        seg.customCommissionDuration = Math.min(Number(seg.duration) || 0, Math.round((workedMsOf(seg, end) || 0) / 60000));
      } else seg.customCommissionDuration = 0;
      seg.lifecycleReason = request.reason?.trim() || '';
      seg.cancelCredit = request.cancelCredit || 'NONE';
      if (request.action === 'SWAP' || request.action === 'CANCEL' && request.cancelCredit !== 'WORKED' || !seg.actualStartTime) {
        voidSegment(seg, end, request.action === 'SWAP' ? 'CHANGED' : request.action === 'CANCEL' ? 'CANCELLED_NO_CREDIT' : 'EARLY_LEAVE_NOT_STARTED');
      } else seg.note = request.action === 'FINISH' ? 'FINISHED_EARLY_ON_PAUSE' : 'CANCELLED_WITH_CREDIT';
      if (request.action === 'SWAP') {
        const minutes = request.assignedMins || Math.max(0, Number(seg.duration) - Number(seg.customCommissionDuration || 0)) + (request.extraTimeMins || 0);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new Error('Thời lượng người thay thế phải từ 1 đến 600 phút.');
        segments.push({ id: `swap-${seg.id}-${Date.parse(at)}`, ktvId: request.newKtvId,
          sequenceSlot: Number(seg.sequenceSlot), roomId: seg.roomId, bedId: seg.bedId,
          startTime: gioDongHoVN(at), endTime: gioDongHoVN(Date.parse(at) + minutes * 60000), duration: minutes,
          plannedStartAt: at, plannedEndAt: new Date(Date.parse(at) + minutes * 60000).toISOString(), note: 'TAKEOVER' });
      }
    }
    if (request.action !== 'SWAP') slots.forEach(slot => closed.add(slot));
    options.closedSequentialSlots = [...closed].sort();
  }
  const remaining = segments.filter(seg => seg.voided !== true && seg.voided !== 'true' && !seg.actualEndTime);
  const paused = remaining.filter(seg => seg.actualStartTime).flatMap(seg => (seg.pauses || []).filter((p: any) => p.from && !p.to));
  const done = sequentialSlotsComplete(options, segments);
  const status = request.action === 'CANCEL' && slots?.includes(1) && slots.includes(2) ? 'CANCELLED'
    : paused.length ? 'PAUSED' : remaining.some(seg => seg.actualStartTime) ? 'IN_PROGRESS'
    : done ? (segments.some(seg => seg.voided !== true && seg.actualStartTime && seg.actualEndTime) ? 'CLEANING' : 'CANCELLED')
    : segments.some(seg => seg.actualStartTime) ? 'IN_PROGRESS' : 'PREPARING';
  const revision = Number(options.dispatchRevision || 0) + 1;
  options.dispatchRevision = revision;
  const changes: any[] = [{ field: 'status', before: item.status, after: status }];
  const oldSegments = parseKtvSegments(item.segments);
  for (const seg of segments) {
    const old = oldSegments.find(previous => previous.id === seg.id);
    for (const field of ['ktvId', 'sequenceSlot', 'startTime', 'endTime', 'duration', 'actualStartTime', 'actualEndTime', 'voided', 'pauses']) {
      if (JSON.stringify(old?.[field] ?? null) !== JSON.stringify(seg[field] ?? null))
        changes.push({ segmentId: seg.id, employeeId: seg.ktvId, field, before: old?.[field] ?? null, after: seg[field] ?? null });
    }
  }
  options.dispatchHistory = [...(options.dispatchHistory || []), { revision, at, action: request.action, actor, changes }];
  options.counterLog = [...(options.counterLog || []), { action: request.action === 'FINISH' ? 'FINISH_EARLY' : request.action === 'SWAP' ? 'SWAP_KTV' : request.action,
    by: actor.id || null, byName: actor.name || null, verified: actor.verified, at,
    note: `${request.action === 'PAUSE' || request.action === 'RESUME' ? running.map(seg => seg.ktvId).join(', ') : slots!.map(slot => slot === 1 ? 'A' : 'B').join(' + ')} · ${request.reason || ''}` }];
  if (status === 'CANCELLED') { options.cancelReason = request.reason || ''; options.cancelCredit = request.cancelCredit || 'NONE'; }
  if (request.action === 'FINISH' && done) options.earlyLeave = true;
  return { segments, options, status, pauseStart: paused[0]?.from || null,
    timeEnd: done ? segments.filter(seg => seg.actualEndTime).map(seg => seg.actualEndTime).sort().at(-1) || null : item.timeEnd || null,
    technicianCodes: [...new Set(segments.map(seg => seg.ktvId).filter(Boolean))] };
}
