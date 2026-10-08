import { getVnDateStr } from '@/lib/time.logic';
import { deriveTaskState, resolveSlotRefs, shiftVnDate, type AcceptPolicy, type TaskState } from '@/lib/services/employeeTasks.service';

// ============================================================
// Office P0 — every write on a task goes through here (plans/plan_office_p0_nen_tang_checklist.md §3.5).
// Each action validates on the server, writes the task, and appends a TaskEvents row.
// ============================================================

const PHOTO_BUCKET = 'task-photos';
const EDITABLE_STATES: TaskState[] = ['TODO', 'DOING', 'FIX'];

export const REVIEW_REASON_CODES = ['NOT_CLEAN', 'WRONG_PLACE', 'MISSING_ANGLE', 'BLURRY', 'NOT_ENOUGH', 'OTHER'] as const;
export const BLOCK_REASON_CODES = ['NO_SUPPLY', 'ROOM_OCCUPIED', 'EQUIPMENT_BROKEN', 'NEED_HELP', 'OTHER'] as const;

export class TaskActionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface PhotoSlot { label: string; ref_path?: string | null }
export interface EvidenceField { kind: 'check' | 'count'; label: string; unit?: string; min?: number }
export interface RejectedSlot { slot: number; reason?: string; mark?: { x: number; y: number } | null }

const nowIso = () => new Date().toISOString();

export const logTaskEvent = async (sb: any, taskId: string | null, actorId: string | null, type: string, payload: Record<string, any> = {}) => {
  const { error } = await sb.from('TaskEvents').insert({ task_id: taskId, actor_id: actorId, type, payload });
  if (error) console.error('[TaskEvents] insert failed:', error.message);
};

const notify = async (sb: any, taskId: string, employeeId: string | null, type: 'REWORK' | 'NEW_TASK' | 'APPROVED', message: string) => {
  if (!employeeId) return;
  const { error } = await sb.from('TaskNotifications').insert({ task_id: taskId, employee_id: employeeId, type, message });
  if (error) console.error('[TaskNotifications] insert failed:', error.message);
};

export const loadTask = async (sb: any, taskId: string) => {
  const { data, error } = await sb.from('Tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) throw new TaskActionError(error.message, 500);
  if (!data) throw new TaskActionError('Không tìm thấy việc.', 404);
  return data;
};

/** Current (not superseded) photos of a task, grouped by slot index (-1 = no slot). */
const currentPhotos = async (sb: any, taskId: string) => {
  const { data } = await sb
    .from('TaskPhotos')
    .select('id, slot_index, storage_path, created_at')
    .eq('task_id', taskId)
    .eq('is_submitted', true)
    .is('superseded_at', null);
  return (data || []) as { id: string; slot_index: number | null; storage_path: string; created_at: string }[];
};

/** What is still missing before the task can go to review. Empty array = complete. */
export const missingEvidence = (task: any, photos: { slot_index: number | null }[]): string[] => {
  const missing: string[] = [];
  const slots: PhotoSlot[] | null = Array.isArray(task.photo_slots) && task.photo_slots.length ? task.photo_slots : null;
  if (slots) {
    slots.forEach((s, i) => { if (!photos.some(p => p.slot_index === i)) missing.push(`Ảnh: ${s.label}`); });
  } else if ((task.min_photo_count ?? 0) > 0 && photos.length < task.min_photo_count) {
    missing.push(`Ảnh: ${photos.length}/${task.min_photo_count}`);
  }
  const fields: EvidenceField[] = Array.isArray(task.evidence_fields) ? task.evidence_fields : [];
  const values = task.evidence_values || {};
  fields.forEach((f, i) => {
    const v = values[String(i)];
    if (f.kind === 'check' ? v !== true : !(typeof v === 'number' && Number.isFinite(v))) missing.push(f.label);
  });
  return missing;
};

const stateOf = (task: any, photoCount = 0) => deriveTaskState(task, photoCount);

const assertEditable = (task: any, photoCount = 0) => {
  const s = stateOf(task, photoCount);
  if (s === 'OFFERED') throw new TaskActionError('Bấm "Nhận việc" trước khi làm.', 409);
  if (!EDITABLE_STATES.includes(s)) throw new TaskActionError('Việc này đang chờ duyệt hoặc đã xong, không sửa được.', 409);
  return s;
};

/** Accept policy that applies to this task (position config, admin-controlled). */
const policyOf = async (sb: any, task: any): Promise<AcceptPolicy> => {
  if (!task.position_id) return 'MANDATORY';
  const { data } = await sb.from('OfficePositions').select('fixed_accept_policy, adhoc_accept_policy').eq('id', task.position_id).maybeSingle();
  if (!data) return 'MANDATORY';
  return (task.task_type === 'AD-HOC' ? data.adhoc_accept_policy : data.fixed_accept_policy) || 'MANDATORY';
};

/** First active position of a staff member (for ad-hoc tasks). */
const positionOfStaff = async (sb: any, staffId: string) => {
  const { data } = await sb
    .from('OfficePositionMembers')
    .select('position_id, OfficePositions!inner(id, is_active, adhoc_accept_policy)')
    .eq('staff_id', staffId)
    .eq('is_active', true);
  return (data || []).map((m: any) => m.OfficePositions).find((p: any) => p?.is_active) || null;
};

// ============================================================
// Staff actions
// ============================================================

export const acceptTask = async (sb: any, taskId: string, actorId: string | null) => {
  const task = await loadTask(sb, taskId);
  if (task.acceptance_status !== 'PENDING') throw new TaskActionError('Việc này không cần bấm nhận.', 409);
  await sb.from('Tasks').update({ acceptance_status: 'ACCEPTED', accepted_at: nowIso() }).eq('id', taskId);
  await logTaskEvent(sb, taskId, actorId, 'ACCEPTED');
};

export const declineTask = async (sb: any, taskId: string, actorId: string | null, reason: string) => {
  if (!reason?.trim()) throw new TaskActionError('Cần ghi lý do từ chối.');
  const task = await loadTask(sb, taskId);
  if (task.acceptance_status !== 'PENDING') throw new TaskActionError('Việc này không ở trạng thái chờ nhận.', 409);
  if ((await policyOf(sb, task)) !== 'ACCEPT_OR_DECLINE') {
    throw new TaskActionError('Vị trí của bạn không được từ chối việc này.', 403);
  }
  await sb.from('Tasks').update({ acceptance_status: 'DECLINED', declined_reason: reason.trim() }).eq('id', taskId);
  // Decision 08/10/2026: a declined task goes back to whoever assigned it (review queue → "Bị từ chối").
  await logTaskEvent(sb, taskId, actorId, 'DECLINED', { reason: reason.trim(), assigned_by: task.assigned_by });
};

export const setEvidenceValues = async (sb: any, taskId: string, actorId: string | null, values: Record<string, unknown>) => {
  const task = await loadTask(sb, taskId);
  assertEditable(task);
  const fields: EvidenceField[] = Array.isArray(task.evidence_fields) ? task.evidence_fields : [];
  const next = { ...(task.evidence_values || {}) };
  for (const [key, raw] of Object.entries(values || {})) {
    const f = fields[Number(key)];
    if (!f) throw new TaskActionError(`Trường không tồn tại: ${key}`);
    if (f.kind === 'check') next[key] = raw === true;
    else {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new TaskActionError(`"${f.label}" phải là số ≥ 0.`);
      next[key] = Math.round(n);
    }
  }
  const patch: any = { evidence_values: next };
  if (task.status === 'NOT_STARTED') patch.status = 'IN_PROGRESS';
  await sb.from('Tasks').update(patch).eq('id', taskId);
  const low = fields
    .map((f, i) => ({ f, v: next[String(i)] }))
    .filter(({ f, v }) => f.kind === 'count' && typeof f.min === 'number' && typeof v === 'number' && v < f.min)
    .map(({ f, v }) => ({ label: f.label, value: v, min: f.min }));
  await logTaskEvent(sb, taskId, actorId, 'EVIDENCE', { values, below_min: low });
  return trySubmit(sb, taskId, actorId);
};

export const blockTask = async (sb: any, taskId: string, actorId: string | null, reasonCode: string, note?: string) => {
  if (!BLOCK_REASON_CODES.includes(reasonCode as any)) throw new TaskActionError('Lý do báo vướng không hợp lệ.');
  const task = await loadTask(sb, taskId);
  assertEditable(task);
  const reason = note?.trim() ? `${reasonCode}: ${note.trim()}` : reasonCode;
  await sb.from('Tasks').update({ status: 'PAUSED', blocked_reason: reason, blocked_at: nowIso() }).eq('id', taskId);
  await logTaskEvent(sb, taskId, actorId, 'BLOCKED', { reason_code: reasonCode, note: note?.trim() || null });
};

export const unblockTask = async (sb: any, taskId: string, actorId: string | null, waiveToday = false) => {
  const task = await loadTask(sb, taskId);
  if (task.status !== 'PAUSED') throw new TaskActionError('Việc này không ở trạng thái báo vướng.', 409);
  const patch: any = { status: 'IN_PROGRESS', blocked_reason: null, blocked_at: null };
  if (waiveToday) patch.blocks_checkout = false;   // supervisor: "Miễn hôm nay"
  await sb.from('Tasks').update(patch).eq('id', taskId);
  await logTaskEvent(sb, taskId, actorId, waiveToday ? 'WAIVED' : 'UNBLOCKED', { previous_reason: task.blocked_reason });
  return waiveToday ? { submitted: false, missing: [] } : trySubmit(sb, taskId, actorId);
};

/**
 * Move the task to review once every photo slot and evidence field is filled.
 * Called automatically after each upload / evidence change — staff never press "submit".
 */
export const trySubmit = async (sb: any, taskId: string, actorId: string | null) => {
  const task = await loadTask(sb, taskId);
  const photos = await currentPhotos(sb, taskId);
  const s = stateOf(task, photos.length);
  if (!EDITABLE_STATES.includes(s)) return { submitted: false, state: s, missing: [] as string[] };
  if (task.status === 'PAUSED') return { submitted: false, state: s, missing: [] as string[] };

  const rejected: RejectedSlot[] = Array.isArray(task.rejected_slots) ? task.rejected_slots : [];
  const missing = missingEvidence(task, photos);
  if (rejected.length) missing.push(...rejected.map(r => `Chụp lại ô ${(task.photo_slots?.[r.slot]?.label) ?? r.slot + 1}`));
  if (missing.length) return { submitted: false, state: s, missing };

  if (task.time_mode === 'WINDOW' && task.window_start_at && task.window_end_at) {
    const now = Date.now();
    if (now < Date.parse(task.window_start_at) || now > Date.parse(task.window_end_at)) {
      throw new TaskActionError('Việc này chỉ nộp được trong khung giờ quy định.', 409);
    }
  }

  const needsReview = task.requires_review !== false;
  await sb.from('Tasks').update({
    status: 'COMPLETED',
    inspection_status: needsReview ? 'PENDING_REVIEW' : 'PASSED',
    submitted_at: nowIso(),
    rejected_slots: null,
  }).eq('id', taskId);
  const late = !!(task.due_at && Date.now() > Date.parse(task.due_at));
  await logTaskEvent(sb, taskId, actorId, 'SUBMITTED', { round: (task.current_review_round || 0) + 1, late, auto_passed: !needsReview });
  return { submitted: true, state: (needsReview ? 'WAITING' : 'APPROVED') as TaskState, missing: [] as string[] };
};

/** Validate an upload target before the file is stored. */
export const assertCanUploadPhoto = async (sb: any, taskId: string, slotIndex: number | null) => {
  const task = await loadTask(sb, taskId);
  const photos = await currentPhotos(sb, taskId);
  const s = assertEditable(task, photos.length);
  const slots: PhotoSlot[] | null = Array.isArray(task.photo_slots) && task.photo_slots.length ? task.photo_slots : null;
  if (slots) {
    if (slotIndex === null || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) {
      throw new TaskActionError('Chọn đúng ô ảnh cần chụp.');
    }
    if (s === 'FIX') {
      const rejected: RejectedSlot[] = Array.isArray(task.rejected_slots) ? task.rejected_slots : [];
      if (!rejected.some(r => r.slot === slotIndex)) throw new TaskActionError('Ô này đã đạt, chỉ chụp lại ô bị trả lại.', 409);
    }
  }
  return task;
};

/** After a photo row is inserted: older photo of the same slot becomes history, then try to submit. */
export const onPhotoUploaded = async (sb: any, task: any, photoId: string, slotIndex: number | null, actorId: string | null) => {
  if (slotIndex !== null) {
    await sb.from('TaskPhotos').update({ superseded_at: nowIso() })
      .eq('task_id', task.id).eq('slot_index', slotIndex).is('superseded_at', null).neq('id', photoId);
  }
  const patch: any = {};
  if (task.status === 'NOT_STARTED') patch.status = 'IN_PROGRESS';
  const rejected: RejectedSlot[] = Array.isArray(task.rejected_slots) ? task.rejected_slots : [];
  if (slotIndex !== null && rejected.some(r => r.slot === slotIndex)) {
    const left = rejected.filter(r => r.slot !== slotIndex);
    patch.rejected_slots = left.length ? left : null;
  }
  if (Object.keys(patch).length) await sb.from('Tasks').update(patch).eq('id', task.id);
  await logTaskEvent(sb, task.id, actorId, 'PHOTO', { photo_id: photoId, slot: slotIndex });
  return trySubmit(sb, task.id, actorId);
};

/** Staff removes a photo before review: kept as history, never deleted. */
export const supersedePhoto = async (sb: any, photoId: string, actorId: string | null) => {
  const { data: photo } = await sb.from('TaskPhotos').select('id, task_id, slot_index, superseded_at').eq('id', photoId).maybeSingle();
  if (!photo) throw new TaskActionError('Không tìm thấy ảnh.', 404);
  if (photo.superseded_at) return photo;
  const task = await loadTask(sb, photo.task_id);
  assertEditable(task, 1);
  await sb.from('TaskPhotos').update({ superseded_at: nowIso() }).eq('id', photoId);
  await logTaskEvent(sb, photo.task_id, actorId, 'PHOTO_REMOVED', { photo_id: photoId, slot: photo.slot_index });
  return photo;
};

// ============================================================
// Supervisor actions (callers must hold support_tasks_admin)
// ============================================================

export interface ReviewInput {
  taskIds: string[];
  decision: 'PASSED' | 'REWORK_REQUIRED';
  reasonCode?: string;
  note?: string;
  rejectedSlots?: RejectedSlot[];
  /** Return every photo slot (screens without per-slot marking, e.g. the employee detail page). */
  allSlots?: boolean;
  photoPath?: string | null;
}

export const reviewTasks = async (sb: any, input: ReviewInput, reviewer: { userId: string | null; actorId: string | null }) => {
  const ids = Array.from(new Set(input.taskIds || [])).filter(Boolean);
  if (!ids.length) throw new TaskActionError('Chưa chọn việc nào.');
  if (input.decision === 'REWORK_REQUIRED') {
    if (ids.length !== 1) throw new TaskActionError('Trả lại từng việc một.');
    if (!input.reasonCode || !REVIEW_REASON_CODES.includes(input.reasonCode as any)) throw new TaskActionError('Chọn lý do trả lại.');
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      const task = await loadTask(sb, id);
      if (task.inspection_status !== 'PENDING_REVIEW') throw new TaskActionError('Việc không ở trạng thái chờ duyệt.', 409);
      const slots: PhotoSlot[] = Array.isArray(task.photo_slots) ? task.photo_slots : [];
      let rejected: RejectedSlot[] | null = null;
      if (input.decision === 'REWORK_REQUIRED') {
        rejected = input.allSlots
          ? slots.map((_, slot) => ({ slot, reason: input.note?.trim() || undefined }))
          : (input.rejectedSlots || []).filter(r => Number.isInteger(r.slot) && (slots.length === 0 || r.slot < slots.length));
        if (slots.length > 0 && rejected.length === 0) throw new TaskActionError('Đánh dấu ít nhất 1 ô ảnh chưa đạt.');
        if (slots.length === 0) rejected = null;   // legacy task without slots: whole task is redone
      }
      const round = (task.current_review_round || 0) + 1;
      const { error: revErr } = await sb.from('TaskReviews').insert({
        task_id: id, round_number: round, reviewer_id: reviewer.userId, decision: input.decision,
        note: input.note?.trim() || null, photo_url: input.photoPath || null,
        reason_code: input.reasonCode || null, rejected_slots: rejected,
      });
      if (revErr) throw new TaskActionError(revErr.message, 500);

      const patch: any = {
        current_review_round: round, inspection_status: input.decision,
        reviewed_by: reviewer.actorId, reviewed_at: nowIso(),
      };
      if (input.decision === 'REWORK_REQUIRED') {
        patch.status = 'IN_PROGRESS';
        patch.rejected_slots = rejected;
        if (!rejected) {
          // No slots: every current photo is redone — keep them as history.
          await sb.from('TaskPhotos').update({ superseded_at: nowIso() }).eq('task_id', id).is('superseded_at', null);
        }
      }
      await sb.from('Tasks').update(patch).eq('id', id);
      await logTaskEvent(sb, id, reviewer.actorId, input.decision === 'PASSED' ? 'APPROVED' : 'RETURNED',
        { round, reason_code: input.reasonCode || null, note: input.note || null, rejected_slots: rejected });
      if (input.decision === 'REWORK_REQUIRED') {
        await notify(sb, id, task.assignee_id, 'REWORK', `Cần sửa: ${task.name}${input.note ? ` — ${input.note}` : ''}`);
      }
      results.push({ id, ok: true });
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message || 'Lỗi' });
    }
  }
  return results;
};

export interface AdhocInput {
  assigneeId: string;
  name: string;
  standardText?: string;
  photoSlots?: string[];
  priority?: 'NORMAL' | 'HIGH';
  dueAt?: string | null;
  blocksCheckout?: boolean;
  categoryId?: string | null;
}

export const createAdhocTask = async (sb: any, input: AdhocInput, assignerId: string | null) => {
  if (!input.assigneeId) throw new TaskActionError('Chọn người nhận việc.');
  if (!input.name?.trim()) throw new TaskActionError('Nhập tên việc.');
  const { data: staff } = await sb.from('Staff').select('id').eq('id', input.assigneeId).maybeSingle();
  if (!staff) throw new TaskActionError('Không tìm thấy nhân viên nhận việc.', 404);

  const labels = (input.photoSlots || []).map(s => s.trim()).filter(Boolean);
  const slots = labels.length ? labels.map(label => ({ label })) : [{ label: 'Ảnh bàn giao' }];
  const position = await positionOfStaff(sb, input.assigneeId);
  const policy: AcceptPolicy = position?.adhoc_accept_policy || 'MANDATORY';

  const { data, error } = await sb.from('Tasks').insert({
    name: input.name.trim(),
    task_type: 'AD-HOC',
    assignee_id: input.assigneeId,
    category_id: input.categoryId || null,
    status: 'NOT_STARTED',
    inspection_status: 'NOT_REVIEWED',
    priority: input.priority === 'NORMAL' ? 'NORMAL' : 'HIGH',
    task_date: getVnDateStr(),
    standard_text: input.standardText?.trim() || null,
    photo_slots: slots,
    min_photo_count: slots.length,
    time_mode: input.dueAt ? 'DEADLINE' : 'FREE',
    due_at: input.dueAt || null,
    blocks_checkout: input.blocksCheckout !== false,
    requires_review: true,
    allow_carry_over: true,
    acceptance_status: policy === 'MANDATORY' ? 'AUTO' : 'PENDING',
    position_id: position?.id || null,
    assigned_by: assignerId,
  }).select('id').single();
  if (error) throw new TaskActionError(error.message, 500);

  await logTaskEvent(sb, data.id, assignerId, 'ASSIGNED', { assignee: input.assigneeId, policy });
  await notify(sb, data.id, input.assigneeId, 'NEW_TASK', `Việc mới: ${input.name.trim()}`);
  return data.id as string;
};

export const cancelTask = async (sb: any, taskId: string, actorId: string | null, reason: string) => {
  if (!reason?.trim()) throw new TaskActionError('Cần ghi lý do huỷ.');
  const task = await loadTask(sb, taskId);
  if (task.cancelled_at) return;
  await sb.from('Tasks').update({ cancelled_at: nowIso(), cancel_reason: reason.trim() }).eq('id', taskId);
  await logTaskEvent(sb, taskId, actorId, 'CANCELLED', { reason: reason.trim() });
};

/** Soft-cancel today's untouched FIXED tasks of a routine that was just removed (replaces the old DELETE). */
export const cancelTodayTasksOfRoutine = async (sb: any, staffIds: string[], templateId: string, roomId: string | null, actorId: string | null) => {
  let q = sb.from('Tasks').select('id')
    .in('assignee_id', staffIds).eq('template_id', templateId).eq('task_type', 'FIXED')
    .eq('status', 'NOT_STARTED').eq('task_date', getVnDateStr()).is('cancelled_at', null);
  q = roomId ? q.eq('room_id', roomId) : q.is('room_id', null);
  const { data } = await q;
  for (const t of data || []) await cancelTask(sb, t.id, actorId, 'Gỡ việc khỏi nhân viên');
  return (data || []).length;
};

export const grantCheckoutOverride = async (sb: any, staffId: string, reason: string, grantedBy: string | null) => {
  if (!staffId) throw new TaskActionError('Thiếu nhân viên.');
  if (!reason?.trim()) throw new TaskActionError('Cần ghi lý do cho tan ca.');
  const { error } = await sb.from('CheckoutOverrides').upsert(
    { staff_id: staffId, business_date: getVnDateStr(), reason: reason.trim(), granted_by: grantedBy },
    { onConflict: 'staff_id,business_date' },
  );
  if (error) throw new TaskActionError(error.message, 500);
  await logTaskEvent(sb, null, grantedBy, 'CHECKOUT_OVERRIDE', { staff_id: staffId, reason: reason.trim() });
};

// ============================================================
// Review queue (supervisor "Cần tôi xử lý")
// ============================================================

export const getReviewQueue = async (sb: any) => {
  const today = getVnDateStr();
  const from = shiftVnDate(today, -1);
  const publicUrl = (path: string | null | undefined) =>
    path ? sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null;

  const { data: tasks, error } = await sb
    .from('Tasks')
    .select('id, name, template_id, task_type, task_date, assignee_id, status, inspection_status, acceptance_status, requires_review, cancelled_at, blocks_checkout, allow_carry_over, photo_slots, evidence_fields, evidence_values, standard_text, submitted_at, current_review_round, blocked_reason, blocked_at, declined_reason, assigned_by, position_id, priority')
    .gte('task_date', from)
    .is('cancelled_at', null)
    .not('assignee_id', 'is', null);
  if (error) throw new TaskActionError(error.message, 500);

  const all = (tasks || []).map((t: any) => ({ ...t, state: deriveTaskState(t, 1) }));
  const waiting = all.filter((t: any) => t.state === 'WAITING');
  const blocked = all.filter((t: any) => t.state === 'BLOCKED');
  const declined = all.filter((t: any) => t.state === 'DECLINED' && t.task_date === today);

  const ids = waiting.map((t: any) => t.id);
  const { data: photos } = ids.length
    ? await sb.from('TaskPhotos').select('id, task_id, slot_index, storage_path, created_at').in('task_id', ids).eq('is_submitted', true).is('superseded_at', null)
    : { data: [] };
  const refsByTask = await resolveSlotRefs(sb, waiting);
  const withPhotos = waiting.map((t: any) => ({
    ...t,
    photos: (photos || []).filter((p: any) => p.task_id === t.id).map((p: any) => ({ id: p.id, slot: p.slot_index, url: publicUrl(p.storage_path) })),
    refs: (refsByTask[t.id] || []).map(r => r.url),
  }));

  // Per-person picture for the checkout tab: today's tasks + yesterday's carry-over.
  const staffIds = Array.from(new Set(all.map((t: any) => t.assignee_id)));
  const { data: staffRows } = staffIds.length ? await sb.from('Staff').select('id, full_name').in('id', staffIds) : { data: [] };
  const { data: members } = staffIds.length
    ? await sb.from('OfficePositionMembers').select('staff_id, OfficePositions!inner(name, shift_end, is_active)').in('staff_id', staffIds).eq('is_active', true)
    : { data: [] };
  const { data: overrides } = staffIds.length
    ? await sb.from('CheckoutOverrides').select('staff_id, reason, granted_by').eq('business_date', today).in('staff_id', staffIds)
    : { data: [] };

  const people = staffIds.map(staffId => {
    const mine = all.filter((t: any) => t.assignee_id === staffId && (t.task_date === today || t.allow_carry_over));
    const blocking = mine.filter((t: any) => t.blocks_checkout && !['APPROVED', 'DECLINED', 'CANCELLED'].includes(t.state));
    const pos = (members || []).find((m: any) => m.staff_id === staffId)?.OfficePositions;
    return {
      staffId,
      name: (staffRows || []).find((s: any) => s.id === staffId)?.full_name || staffId,
      position: pos?.name || null,
      shiftEnd: pos?.shift_end || null,
      total: mine.length,
      approved: mine.filter((t: any) => t.state === 'APPROVED').length,
      staffToDo: blocking.filter((t: any) => ['TODO', 'DOING', 'FIX', 'BLOCKED', 'OFFERED'].includes(t.state)).length,
      supervisorToReview: blocking.filter((t: any) => t.state === 'WAITING').length,
      override: (overrides || []).find((o: any) => o.staff_id === staffId) || null,
    };
  }).sort((a, b) => (a.shiftEnd || '99').localeCompare(b.shiftEnd || '99'));

  const endOf = (staffId: string) => people.find(p => p.staffId === staffId)?.shiftEnd || '99';
  withPhotos.sort((a: any, b: any) => endOf(a.assignee_id).localeCompare(endOf(b.assignee_id)) || String(a.submitted_at).localeCompare(String(b.submitted_at)));

  return { waiting: withPhotos, blocked, declined, people };
};

// ============================================================
// Positions & template sets (admin config)
// ============================================================

const POLICIES: AcceptPolicy[] = ['MANDATORY', 'ACCEPT_REQUIRED', 'ACCEPT_OR_DECLINE'];

export interface PositionInput {
  id?: string;
  name: string;
  branch?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  fixed_accept_policy?: AcceptPolicy;
  adhoc_accept_policy?: AcceptPolicy;
  is_active?: boolean;
  memberIds?: string[];
  setIds?: string[];
}

export const listPositions = async (sb: any) => {
  const { data: positions, error } = await sb.from('OfficePositions').select('*').order('name');
  if (error) throw new TaskActionError(error.message, 500);
  const ids = (positions || []).map((p: any) => p.id);
  const { data: members } = ids.length ? await sb.from('OfficePositionMembers').select('position_id, staff_id, is_active').in('position_id', ids) : { data: [] };
  const { data: sets } = ids.length ? await sb.from('OfficePositionTemplateSets').select('position_id, set_id').in('position_id', ids) : { data: [] };
  return (positions || []).map((p: any) => ({
    ...p,
    memberIds: (members || []).filter((m: any) => m.position_id === p.id && m.is_active).map((m: any) => m.staff_id),
    setIds: (sets || []).filter((s: any) => s.position_id === p.id).map((s: any) => s.set_id),
  }));
};

export const savePosition = async (sb: any, input: PositionInput, actorId: string | null) => {
  if (!input.name?.trim()) throw new TaskActionError('Nhập tên vị trí.');
  for (const p of [input.fixed_accept_policy, input.adhoc_accept_policy]) {
    if (p && !POLICIES.includes(p)) throw new TaskActionError('Chính sách nhận việc không hợp lệ.');
  }
  const row: any = {
    name: input.name.trim(), branch: input.branch ?? null,
    shift_start: input.shift_start || null, shift_end: input.shift_end || null,
    is_active: input.is_active !== false,
  };
  if (input.fixed_accept_policy) row.fixed_accept_policy = input.fixed_accept_policy;
  if (input.adhoc_accept_policy) row.adhoc_accept_policy = input.adhoc_accept_policy;

  let id = input.id;
  let before: any = null;
  if (id) {
    const { data } = await sb.from('OfficePositions').select('fixed_accept_policy, adhoc_accept_policy').eq('id', id).maybeSingle();
    before = data;
    const { error } = await sb.from('OfficePositions').update(row).eq('id', id);
    if (error) throw new TaskActionError(error.message, 500);
  } else {
    const { data, error } = await sb.from('OfficePositions').insert(row).select('id').single();
    if (error) throw new TaskActionError(error.message, 500);
    id = data.id;
  }

  if (input.memberIds) {
    await sb.from('OfficePositionMembers').update({ is_active: false }).eq('position_id', id);
    const rows = Array.from(new Set(input.memberIds.filter(Boolean))).map(staff_id => ({ position_id: id, staff_id, is_active: true }));
    if (rows.length) await sb.from('OfficePositionMembers').upsert(rows, { onConflict: 'position_id,staff_id' });
  }
  if (input.setIds) {
    await sb.from('OfficePositionTemplateSets').delete().eq('position_id', id);
    const rows = Array.from(new Set(input.setIds.filter(Boolean))).map(set_id => ({ position_id: id, set_id }));
    if (rows.length) await sb.from('OfficePositionTemplateSets').insert(rows);
  }

  // Policy changes apply to tasks assigned from now on; existing tasks keep their acceptance_status.
  if (before && (before.fixed_accept_policy !== row.fixed_accept_policy || before.adhoc_accept_policy !== row.adhoc_accept_policy)) {
    await logTaskEvent(sb, null, actorId, 'POSITION_POLICY_CHANGED', { position_id: id, before, after: { fixed: row.fixed_accept_policy, adhoc: row.adhoc_accept_policy } });
  }
  return id;
};

export interface TemplateSetInput { id?: string; name: string; description?: string | null; is_active?: boolean; categoryIds?: string[] }

export const listTemplateSets = async (sb: any) => {
  const { data: sets, error } = await sb.from('OfficeTemplateSets').select('*').order('name');
  if (error) throw new TaskActionError(error.message, 500);
  const ids = (sets || []).map((s: any) => s.id);
  const { data: cats } = ids.length ? await sb.from('OfficeTemplateSetCategories').select('set_id, category_id, sort_order').in('set_id', ids) : { data: [] };
  return (sets || []).map((s: any) => ({
    ...s,
    categoryIds: (cats || []).filter((c: any) => c.set_id === s.id).sort((a: any, b: any) => a.sort_order - b.sort_order).map((c: any) => c.category_id),
  }));
};

export const saveTemplateSet = async (sb: any, input: TemplateSetInput) => {
  if (!input.name?.trim()) throw new TaskActionError('Nhập tên bộ việc.');
  const row = { name: input.name.trim(), description: input.description ?? null, is_active: input.is_active !== false };
  let id = input.id;
  if (id) {
    const { data: cur } = await sb.from('OfficeTemplateSets').select('version').eq('id', id).maybeSingle();
    const { error } = await sb.from('OfficeTemplateSets').update({ ...row, version: (cur?.version || 1) + (input.categoryIds ? 1 : 0) }).eq('id', id);
    if (error) throw new TaskActionError(error.message, 500);
  } else {
    const { data, error } = await sb.from('OfficeTemplateSets').insert(row).select('id').single();
    if (error) throw new TaskActionError(error.message, 500);
    id = data.id;
  }
  if (input.categoryIds) {
    await sb.from('OfficeTemplateSetCategories').delete().eq('set_id', id);
    const rows = Array.from(new Set(input.categoryIds.filter(Boolean))).map((category_id, i) => ({ set_id: id, category_id, sort_order: i }));
    if (rows.length) await sb.from('OfficeTemplateSetCategories').insert(rows);
  }
  return id;
};

/** Pickers for the admin screens: working staff, task categories, template sets. */
export const listOfficeOptions = async (sb: any) => {
  const [{ data: staff }, { data: categories }] = await Promise.all([
    sb.from('Staff').select('id, full_name, work_type, position').eq('status', 'ĐANG LÀM').order('id'),
    sb.from('TaskCategories').select('id, name, type').order('name'),
  ]);
  return {
    staff: (staff || []).map((s: any) => ({ id: s.id, name: s.full_name || s.id, workType: s.work_type, title: s.position || null })),
    categories: categories || [],
  };
};

// ============================================================
// Declined task → back to the assigner, who reassigns or cancels (decision 08/10/2026)
// ============================================================

export const reassignTask = async (sb: any, taskId: string, newAssigneeId: string, actorId: string | null) => {
  if (!newAssigneeId) throw new TaskActionError('Chọn người nhận mới.');
  const task = await loadTask(sb, taskId);
  if (task.cancelled_at) throw new TaskActionError('Việc đã huỷ.', 409);
  if (task.acceptance_status !== 'DECLINED') throw new TaskActionError('Chỉ giao lại việc đã bị từ chối.', 409);
  if (newAssigneeId === task.assignee_id) throw new TaskActionError('Chọn người khác với người đã từ chối.');
  const { data: staff } = await sb.from('Staff').select('id').eq('id', newAssigneeId).maybeSingle();
  if (!staff) throw new TaskActionError('Không tìm thấy nhân viên nhận việc.', 404);

  // The new person's own position decides whether they must press "Nhận".
  const position = await positionOfStaff(sb, newAssigneeId);
  const policy: AcceptPolicy = (task.task_type === 'AD-HOC' ? position?.adhoc_accept_policy : position?.fixed_accept_policy) || 'MANDATORY';
  await sb.from('Tasks').update({
    assignee_id: newAssigneeId,
    acceptance_status: policy === 'MANDATORY' ? 'AUTO' : 'PENDING',
    declined_reason: null,
    accepted_at: null,
    position_id: position?.id || null,
  }).eq('id', taskId);
  await logTaskEvent(sb, taskId, actorId, 'REASSIGNED', { from: task.assignee_id, to: newAssigneeId, policy });
  await notify(sb, taskId, newAssigneeId, 'NEW_TASK', `Việc mới: ${task.name}`);
};

// ============================================================
// Task template detail config (admin) — applies to tasks generated after the save;
// tasks already generated keep their snapshot.
// ============================================================

const TIME_MODES = ['FREE', 'DEADLINE', 'WINDOW', 'MULTI'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SLOTS = 12;
const MAX_FIELDS = 10;

export interface TemplateConfigInput {
  standard_text?: string | null;
  sop?: string[] | null;
  photo_slots?: PhotoSlot[] | null;
  evidence_fields?: EvidenceField[] | null;
  time_mode?: typeof TIME_MODES[number];
  due_time?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  multi_times?: string[] | null;
  blocks_checkout?: boolean;
  requires_review?: boolean;
  allow_carry_over?: boolean;
}

const TEMPLATE_CONFIG_COLUMNS =
  'id, name, category_id, requires_photo, min_photo_count, standard_text, sop, photo_slots, evidence_fields, ' +
  'time_mode, due_time, window_start, window_end, multi_times, blocks_checkout, requires_review, allow_carry_over, is_active';

export const getTemplateConfig = async (sb: any, templateId: string) => {
  const { data, error } = await sb.from('TaskTemplates').select(TEMPLATE_CONFIG_COLUMNS).eq('id', templateId).maybeSingle();
  if (error) throw new TaskActionError(error.message, 500);
  if (!data) throw new TaskActionError('Không tìm thấy việc mẫu.', 404);
  const slots: PhotoSlot[] = Array.isArray(data.photo_slots) ? data.photo_slots : [];
  return {
    ...data,
    refUrls: slots.map(s => (s.ref_path ? sb.storage.from(PHOTO_BUCKET).getPublicUrl(s.ref_path).data.publicUrl : null)),
  };
};

const hhmm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '');

export const saveTemplateConfig = async (sb: any, templateId: string, input: TemplateConfigInput, actorId: string | null) => {
  const mode = input.time_mode || 'FREE';
  if (!TIME_MODES.includes(mode)) throw new TaskActionError('Chế độ thời gian không hợp lệ.');

  const slots = (input.photo_slots || [])
    .map(s => ({ label: String(s?.label || '').trim(), ref_path: s?.ref_path ? String(s.ref_path) : null }))
    .filter(s => s.label);
  if (slots.length > MAX_SLOTS) throw new TaskActionError(`Tối đa ${MAX_SLOTS} ô ảnh.`);
  if (slots.some(s => s.ref_path && !s.ref_path.startsWith('refs/'))) throw new TaskActionError('Ảnh mẫu không hợp lệ.');

  const fields: EvidenceField[] = [];
  for (const f of input.evidence_fields || []) {
    const label = String(f?.label || '').trim();
    if (!label) continue;
    if (f.kind === 'check') fields.push({ kind: 'check', label });
    else if (f.kind === 'count') {
      const min = f.min === undefined || f.min === null || (f.min as any) === '' ? undefined : Number(f.min);
      if (min !== undefined && (!Number.isFinite(min) || min < 0)) throw new TaskActionError(`Mức tối thiểu của "${label}" không hợp lệ.`);
      fields.push({ kind: 'count', label, ...(f.unit?.trim() ? { unit: f.unit.trim() } : {}), ...(min !== undefined ? { min } : {}) });
    }
  }
  if (fields.length > MAX_FIELDS) throw new TaskActionError(`Tối đa ${MAX_FIELDS} trường số liệu.`);

  const row: any = {
    standard_text: input.standard_text?.trim() || null,
    sop: (input.sop || []).map(s => String(s).trim()).filter(Boolean),
    photo_slots: slots.length ? slots : null,
    evidence_fields: fields.length ? fields : null,
    time_mode: mode,
    due_time: null, window_start: null, window_end: null, multi_times: null,
    blocks_checkout: input.blocks_checkout !== false,
    requires_review: input.requires_review !== false,
    allow_carry_over: input.allow_carry_over !== false,
  };
  if (!row.sop.length) row.sop = null;
  // Named slots define the photo requirement; keep the legacy columns consistent for old readers.
  if (slots.length) { row.requires_photo = true; row.min_photo_count = slots.length; }

  if (mode === 'DEADLINE') {
    if (!HHMM.test(hhmm(input.due_time))) throw new TaskActionError('Nhập giờ hạn chót (HH:mm).');
    row.due_time = hhmm(input.due_time);
  } else if (mode === 'WINDOW') {
    const a = hhmm(input.window_start), b = hhmm(input.window_end);
    if (!HHMM.test(a) || !HHMM.test(b)) throw new TaskActionError('Nhập khung giờ nộp (HH:mm).');
    if (a >= b) throw new TaskActionError('Giờ bắt đầu khung phải trước giờ kết thúc.');
    row.window_start = a; row.window_end = b;
  } else if (mode === 'MULTI') {
    const times = Array.from(new Set((input.multi_times || []).map(hhmm).filter(t => HHMM.test(t)))).sort();
    if (!times.length) throw new TaskActionError('Nhập ít nhất 1 mốc giờ lặp.');
    row.multi_times = times;
  }

  const { error } = await sb.from('TaskTemplates').update(row).eq('id', templateId);
  if (error) throw new TaskActionError(error.message, 500);
  await logTaskEvent(sb, null, actorId, 'TEMPLATE_CONFIG_CHANGED', { template_id: templateId, time_mode: mode, slots: slots.length, fields: fields.length });
};

// ============================================================
// "Kho việc" — category + its task templates (moved from the client before RLS was narrowed)
// ============================================================

const REPEAT_MODES = ['DAILY', 'WEEKLY', 'WEEKLY_SUNDAY', 'WEEKLY_MONDAY', 'WEEKLY_TUESDAY', 'WEEKLY_WEDNESDAY', 'WEEKLY_THURSDAY', 'WEEKLY_FRIDAY', 'WEEKLY_SATURDAY'];

export interface CategoryTemplatesInput {
  categoryId?: string | null;
  name: string;
  type?: 'ROLE' | 'ROOM';
  repeatMode?: string;
  tasks: { id?: string; name: string; requires_photo?: boolean; min_photo_count?: number; cron_schedule?: string | null }[];
}

/** Create / update a category and its templates; templates removed from the list are deactivated, never deleted. */
export const saveCategoryWithTemplates = async (sb: any, input: CategoryTemplatesInput, actorId: string | null) => {
  const name = input.name?.trim();
  if (!name) throw new TaskActionError('Nhập tên nhóm việc.');
  const type = input.type === 'ROOM' ? 'ROOM' : 'ROLE';
  const repeatMode = REPEAT_MODES.includes(input.repeatMode || '') ? input.repeatMode : 'DAILY';

  let categoryId = input.categoryId || null;
  if (categoryId) {
    const { error } = await sb.from('TaskCategories').update({ name, type, repeat_mode: repeatMode }).eq('id', categoryId);
    if (error) throw new TaskActionError(error.message, 500);
  } else {
    const { data, error } = await sb.from('TaskCategories').insert({ name, type, repeat_mode: repeatMode }).select('id').single();
    if (error) throw new TaskActionError(error.message, 500);
    categoryId = data.id;
  }

  const kept: string[] = [];
  const rows = (input.tasks || []).filter(t => t?.name?.trim());
  for (const [i, t] of rows.entries()) {
    const base = {
      name: t.name.trim(),
      requires_photo: !!t.requires_photo,
      min_photo_count: Math.max(0, Math.min(20, Number(t.min_photo_count) || 0)),
      sort_order: i,
      cron_schedule: t.cron_schedule?.trim() || null,
    };
    if (t.id) {
      // Only templates of this category can be edited from this form.
      const { error } = await sb.from('TaskTemplates').update(base).eq('id', t.id).eq('category_id', categoryId);
      if (error) throw new TaskActionError(error.message, 500);
      kept.push(t.id);
    } else {
      const { data, error } = await sb.from('TaskTemplates').insert({ ...base, category_id: categoryId, is_active: true }).select('id').single();
      if (error) throw new TaskActionError(error.message, 500);
      kept.push(data.id);
    }
  }

  const { data: active } = await sb.from('TaskTemplates').select('id').eq('category_id', categoryId).eq('is_active', true);
  const removed = (active || []).map((r: any) => r.id).filter((id: string) => !kept.includes(id));
  if (removed.length) await sb.from('TaskTemplates').update({ is_active: false }).in('id', removed);
  await logTaskEvent(sb, null, actorId, 'CATEGORY_SAVED', { category_id: categoryId, templates: kept.length, deactivated: removed.length });
  return { categoryId, deactivated: removed.length };
};

// ============================================================
// Sample photo from a real submission (supervisor, while reviewing)
// ============================================================

/** Point one template slot at a sample already stored under refs/. Every task of the template shows it (both sides). */
export const setSlotSample = async (sb: any, templateId: string, slot: number, refPath: string, actorId: string | null, taskId: string | null = null) => {
  if (!templateId) throw new TaskActionError('Việc đột xuất không có việc mẫu để gắn ảnh mẫu.');
  if (!String(refPath || '').startsWith('refs/')) throw new TaskActionError('Ảnh mẫu không hợp lệ.');
  const { data: tpl } = await sb.from('TaskTemplates').select('id, photo_slots').eq('id', templateId).maybeSingle();
  const slots: PhotoSlot[] = Array.isArray(tpl?.photo_slots) ? tpl.photo_slots : [];
  if (!Number.isInteger(slot) || !slots[slot]) throw new TaskActionError('Việc mẫu không có ô ảnh này.', 409);
  const next = slots.map((s, i) => (i === slot ? { ...s, ref_path: refPath } : s));
  const { error } = await sb.from('TaskTemplates').update({ photo_slots: next }).eq('id', templateId);
  if (error) throw new TaskActionError(error.message, 500);
  await logTaskEvent(sb, taskId, actorId, 'SAMPLE_SET', { template_id: templateId, slot, ref_path: refPath });
  return { refPath, url: sb.storage.from(PHOTO_BUCKET).getPublicUrl(refPath).data.publicUrl };
};

/** Copy a submitted slot photo to refs/ and make it that template slot's sample. */
export const setSlotSampleFromPhoto = async (sb: any, photoId: string, actorId: string | null) => {
  const { data: photo } = await sb.from('TaskPhotos').select('id, task_id, slot_index, storage_path, superseded_at').eq('id', photoId).maybeSingle();
  if (!photo || photo.superseded_at) throw new TaskActionError('Không tìm thấy ảnh.', 404);
  if (photo.slot_index === null || photo.slot_index === undefined) throw new TaskActionError('Ảnh này không thuộc ô có nhãn.');
  const task = await loadTask(sb, photo.task_id);
  if (!task.template_id) throw new TaskActionError('Việc đột xuất không có việc mẫu để gắn ảnh mẫu.');
  const ext = String(photo.storage_path).split('.').pop() || 'jpg';
  const target = `refs/${task.template_id}_${photo.slot_index}_${Date.now()}.${ext}`;
  const { error: cpErr } = await sb.storage.from(PHOTO_BUCKET).copy(photo.storage_path, target);
  if (cpErr) throw new TaskActionError(cpErr.message, 500);
  return setSlotSample(sb, task.template_id, photo.slot_index, target, actorId, task.id);
};
