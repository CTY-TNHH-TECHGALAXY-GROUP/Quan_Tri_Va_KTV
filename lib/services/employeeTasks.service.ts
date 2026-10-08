import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getVnDateStr } from '@/lib/time.logic';

// ============================================================
// 🔧 CONSTANTS
// ============================================================
// Office P0 (plans/plan_office_p0_nen_tang_checklist.md). The columns read here
// come from migration 20261009090000_office_p0_checklist_foundation.sql.

const CARRY_OVER_MAX_DAYS = 1;

const TEMPLATE_FIELDS =
  'id, name, description, category_id, requires_photo, min_photo_count, sort_order, cron_schedule, is_active, ' +
  'standard_text, sop, photo_slots, evidence_fields, time_mode, due_time, window_start, window_end, multi_times, ' +
  'blocks_checkout, requires_review, allow_carry_over, TaskCategories(repeat_mode)';

const TASK_FIELDS =
  'id, name, status, inspection_status, task_type, priority, template_id, category_id, room_id, min_photo_count, ' +
  'updated_at, created_at, task_date, slot_time, standard_text, sop, photo_slots, evidence_fields, evidence_values, ' +
  'time_mode, due_at, window_start_at, window_end_at, blocks_checkout, requires_review, allow_carry_over, ' +
  'acceptance_status, declined_reason, submitted_at, rejected_slots, blocked_reason, blocked_at, cancelled_at, ' +
  'TaskTemplates(requires_photo, min_photo_count, sort_order), TaskCategories(name), Rooms(name, has_guests, updated_at), ' +
  'TaskReviews(note, photo_url, created_at)';

export type AcceptPolicy = 'MANDATORY' | 'ACCEPT_REQUIRED' | 'ACCEPT_OR_DECLINE';

export type TaskState =
  | 'OFFERED' | 'TODO' | 'DOING' | 'WAITING' | 'FIX' | 'APPROVED' | 'BLOCKED' | 'DECLINED' | 'CANCELLED';

export interface TaskStateInput {
  status: string;
  inspection_status: string;
  acceptance_status?: string | null;
  requires_review?: boolean | null;
  cancelled_at?: string | null;
}

// ============================================================
// 🕒 VN DATE HELPERS (server runs in UTC — never use getHours/toLocaleDateString)
// ============================================================

/** Shift a 'YYYY-MM-DD' business date by n days. */
export const shiftVnDate = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Day of week (0 = Sunday) of a 'YYYY-MM-DD' business date. */
const vnDayOfWeek = (dateStr: string): number => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

/** 'YYYY-MM-DD' + 'HH:mm[:ss]' in VN time → ISO instant. */
const vnTimeToIso = (dateStr: string, time: string): string =>
  new Date(`${dateStr}T${time.length === 5 ? `${time}:00` : time}+07:00`).toISOString();

const shouldGenerateOn = (dateStr: string, repeatMode?: string | null, cronSchedule?: string | null): boolean => {
  if (!repeatMode || repeatMode === 'DAILY') return true;
  const day = vnDayOfWeek(dateStr);
  const WEEKLY_FIXED: Record<string, number> = {
    WEEKLY_SUNDAY: 0, WEEKLY_MONDAY: 1, WEEKLY_TUESDAY: 2, WEEKLY_WEDNESDAY: 3,
    WEEKLY_THURSDAY: 4, WEEKLY_FRIDAY: 5, WEEKLY_SATURDAY: 6,
  };
  if (repeatMode in WEEKLY_FIXED) return WEEKLY_FIXED[repeatMode] === day;
  if (repeatMode === 'WEEKLY' && cronSchedule) return cronSchedule.split(',').map(Number).includes(day);
  return false;
};

// ============================================================
// 🧭 TASK STATE — the single source for every screen and the checkout gate
// ============================================================

export const deriveTaskState = (t: TaskStateInput, doneSlots = 0): TaskState => {
  if (t.cancelled_at) return 'CANCELLED';
  if (t.acceptance_status === 'DECLINED') return 'DECLINED';
  if (t.acceptance_status === 'PENDING') return 'OFFERED';
  if (t.inspection_status === 'PASSED') return 'APPROVED';
  if (t.requires_review === false && t.status === 'COMPLETED') return 'APPROVED';
  if (t.status === 'PAUSED') return 'BLOCKED';
  if (t.inspection_status === 'REWORK_REQUIRED') return 'FIX';
  if (t.inspection_status === 'PENDING_REVIEW') return 'WAITING';
  return doneSlots === 0 ? 'TODO' : 'DOING';
};

/** A task in this state still keeps its assignee from checking out. */
export const isCheckoutBlocking = (s: TaskState): boolean => !['APPROVED', 'DECLINED', 'CANCELLED'].includes(s);

// ============================================================
// 📋 TEMPLATE → TASK SNAPSHOT
// ============================================================

const snapshotFromTemplate = (tpl: any, dateStr: string) => {
  const mode = tpl.time_mode || 'FREE';
  const slots = Array.isArray(tpl.photo_slots) && tpl.photo_slots.length > 0 ? tpl.photo_slots : null;
  return {
    standard_text: tpl.standard_text ?? tpl.description ?? null,
    sop: tpl.sop ?? null,
    photo_slots: slots,
    evidence_fields: tpl.evidence_fields ?? null,
    time_mode: mode,
    due_at: mode === 'DEADLINE' && tpl.due_time ? vnTimeToIso(dateStr, tpl.due_time) : null,
    window_start_at: mode === 'WINDOW' && tpl.window_start ? vnTimeToIso(dateStr, tpl.window_start) : null,
    window_end_at: mode === 'WINDOW' && tpl.window_end ? vnTimeToIso(dateStr, tpl.window_end) : null,
    blocks_checkout: tpl.blocks_checkout ?? true,
    requires_review: tpl.requires_review ?? true,
    allow_carry_over: tpl.allow_carry_over ?? true,
    min_photo_count: slots ? slots.length : (tpl.requires_photo === false ? 0 : (tpl.min_photo_count ?? 1)),
  };
};

interface EffectiveRoutine {
  template_id: string;
  room_id: string | null;
  position_id: string | null;
  accept_policy: AcceptPolicy;
  tpl: any;
}

export class EmployeeTasksService {
  /**
   * Tasks a staff member owns on a day = templates of their positions' template sets
   * ∪ personal ADD routines − personal EXCLUDE routines.
   * `aliasIds` keeps old EmployeeRoutines rows written under Users.id working.
   */
  static async resolveEffectiveRoutines(supabase: any, staffId: string, aliasIds: string[] = []): Promise<EffectiveRoutine[]> {
    const routineOwnerIds = Array.from(new Set([staffId, ...aliasIds].filter(Boolean)));
    const byKey = new Map<string, EffectiveRoutine>();
    const keyOf = (templateId: string, roomId: string | null) => `${templateId}|${roomId || ''}`;

    // 1. Position template sets
    let defaultPolicy: AcceptPolicy = 'MANDATORY';
    const { data: members } = await supabase
      .from('OfficePositionMembers')
      .select('position_id, OfficePositions!inner(id, is_active, fixed_accept_policy)')
      .eq('staff_id', staffId)
      .eq('is_active', true);
    const positions = (members || []).map((m: any) => m.OfficePositions).filter((p: any) => p?.is_active);

    if (positions.length > 0) {
      defaultPolicy = positions[0].fixed_accept_policy || 'MANDATORY';
      const positionIds = positions.map((p: any) => p.id);
      const { data: links } = await supabase
        .from('OfficePositionTemplateSets')
        .select('position_id, set_id, OfficeTemplateSets!inner(is_active)')
        .in('position_id', positionIds);
      const activeLinks = (links || []).filter((l: any) => l.OfficeTemplateSets?.is_active);
      const setIds = Array.from(new Set(activeLinks.map((l: any) => l.set_id)));

      if (setIds.length > 0) {
        const { data: setCats } = await supabase
          .from('OfficeTemplateSetCategories')
          .select('set_id, category_id')
          .in('set_id', setIds);
        const categoryIds = Array.from(new Set((setCats || []).map((c: any) => c.category_id)));
        const { data: templates } = categoryIds.length
          ? await supabase.from('TaskTemplates').select(TEMPLATE_FIELDS).in('category_id', categoryIds).eq('is_active', true)
          : { data: [] };

        for (const tpl of templates || []) {
          const setId = (setCats || []).find((c: any) => c.category_id === tpl.category_id)?.set_id;
          const link = activeLinks.find((l: any) => l.set_id === setId);
          const pos = positions.find((p: any) => p.id === link?.position_id) || positions[0];
          byKey.set(keyOf(tpl.id, null), {
            template_id: tpl.id, room_id: null, position_id: pos.id,
            accept_policy: pos.fixed_accept_policy || 'MANDATORY', tpl,
          });
        }
      }
    }

    // 2. Personal customisation on top of the template
    const { data: routines, error } = await supabase
      .from('EmployeeRoutines')
      .select(`template_id, room_id, mode, TaskTemplates(${TEMPLATE_FIELDS})`)
      .in('employee_id', routineOwnerIds)
      .eq('is_active', true);
    if (error) {
      console.error('[EmployeeTasksService] routines:', error.message, error.code);
      throw new Error('Failed to fetch routines');
    }

    for (const r of (routines || []).filter((x: any) => x.mode !== 'EXCLUDE')) {
      if (!r.TaskTemplates) continue;
      byKey.set(keyOf(r.template_id, r.room_id), {
        template_id: r.template_id, room_id: r.room_id || null,
        position_id: byKey.get(keyOf(r.template_id, r.room_id))?.position_id ?? null,
        accept_policy: defaultPolicy, tpl: r.TaskTemplates,
      });
    }
    for (const r of (routines || []).filter((x: any) => x.mode === 'EXCLUDE')) {
      byKey.delete(keyOf(r.template_id, r.room_id));
    }

    return Array.from(byKey.values()).filter(r => r.tpl?.is_active !== false);
  }

  /**
   * Make sure the staff member's tasks for `dateStr` exist. Idempotent through the
   * unique `Tasks.dedupe_key`: safe to call from page load, check-in, the checkout
   * gate and the cron at the same time, on any number of instances.
   * Never deletes anything — a template removed from someone simply stops generating.
   */
  static async ensureTasksForDate(staffId: string, dateStr: string = getVnDateStr(), includeRoomTasks = true, aliasIds: string[] = []) {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');
    const ownerIds = Array.from(new Set([staffId, ...aliasIds].filter(Boolean)));

    const { data: leaveData } = await supabase
      .from('KTVLeaveRequests')
      .select('id')
      .in('employeeId', ownerIds)
      .eq('date', dateStr)
      .eq('status', 'APPROVED');
    if (leaveData && leaveData.length > 0) return { success: true, count: 0, reason: 'ON_LEAVE' };

    const { data: dailyAtt } = await supabase
      .from('DailyAttendance')
      .select('status')
      .in('employee_id', ownerIds)
      .eq('date', dateStr);
    if (dailyAtt && dailyAtt.some((a: any) => ['absent', 'off_leave', 'off_duty'].includes(a.status))) {
      return { success: true, count: 0, reason: 'OFF_DUTY' };
    }

    const routines = await EmployeeTasksService.resolveEffectiveRoutines(supabase, staffId, aliasIds);

    const { data: roomMatrixData } = await supabase
      .from('RoomTaskTemplates')
      .select('template_id, room_id, custom_min_photo_count');
    const customPhotoMap = new Map<string, number>();
    (roomMatrixData || []).forEach((r: any) => {
      if (r.custom_min_photo_count !== null && r.custom_min_photo_count !== undefined) {
        customPhotoMap.set(`${r.template_id}_${r.room_id}`, r.custom_min_photo_count);
      }
    });

    const buildRows = (r: { template_id: string; room_id: string | null; tpl: any }, assignee: string | null, extra: Record<string, any>) => {
      const tpl = r.tpl;
      const times: (string | null)[] = tpl.time_mode === 'MULTI' && Array.isArray(tpl.multi_times) && tpl.multi_times.length
        ? tpl.multi_times : [null];
      return times.map(slotTime => {
        const snap = snapshotFromTemplate(tpl, dateStr);
        const customCount = customPhotoMap.get(`${r.template_id}_${r.room_id}`);
        return {
          template_id: r.template_id,
          room_id: r.room_id || null,
          category_id: tpl.category_id || null,
          name: slotTime ? `${tpl.name} — ${slotTime}` : (tpl.name || 'Công việc'),
          task_type: 'FIXED',
          assignee_id: assignee,
          status: 'NOT_STARTED',
          inspection_status: 'NOT_REVIEWED',
          priority: 'NORMAL',
          sort_order: tpl.sort_order || 0,
          task_date: dateStr,
          slot_time: slotTime,
          ...snap,
          min_photo_count: snap.photo_slots ? snap.min_photo_count : (customCount ?? snap.min_photo_count),
          ...extra,
          dedupe_key: assignee
            ? `F|${assignee}|${r.template_id}|${r.room_id || ''}|${dateStr}|${slotTime || ''}`
            : `R|${r.room_id || ''}|${r.template_id}|${dateStr}|${slotTime || ''}`,
        };
      });
    };

    const newTasks: any[] = routines
      .filter(r => shouldGenerateOn(dateStr, r.tpl?.TaskCategories?.repeat_mode, r.tpl?.cron_schedule))
      .flatMap(r => buildRows(r, staffId, {
        position_id: r.position_id,
        acceptance_status: r.accept_policy === 'MANDATORY' ? 'AUTO' : 'PENDING',
      }));

    if (includeRoomTasks) {
      // Shared room tasks (assignee_id = null) — skipped when someone already owns that room/template.
      const ownedRoomKeys = new Set(routines.filter(r => r.room_id).map(r => `${r.template_id}_${r.room_id}`));
      const { data: roomRoutines } = await supabase
        .from('RoomTaskTemplates')
        .select(`template_id, room_id, TaskTemplates(${TEMPLATE_FIELDS})`);
      (roomRoutines || [])
        .filter((r: any) => r.TaskTemplates && r.TaskTemplates.is_active !== false)
        .filter((r: any) => !ownedRoomKeys.has(`${r.template_id}_${r.room_id}`))
        .filter((r: any) => shouldGenerateOn(dateStr, r.TaskTemplates?.TaskCategories?.repeat_mode, r.TaskTemplates?.cron_schedule))
        .forEach((r: any) => newTasks.push(...buildRows({ template_id: r.template_id, room_id: r.room_id, tpl: r.TaskTemplates }, null, {})));
    }

    if (newTasks.length === 0) return { success: true, count: 0 };

    const { error: insertErr } = await supabase
      .from('Tasks')
      .upsert(newTasks, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (insertErr) {
      console.error('[EmployeeTasksService] insert generated tasks:', insertErr.message, insertErr.code);
      throw new Error('Failed to generate tasks');
    }
    return { success: true, count: newTasks.length };
  }

  /** @deprecated kept for the current GET route until step 3 — use ensureTasksForDate. */
  static async generateTodayTasks(empIds: string[], includeRoomTasks: boolean = true) {
    const [staffId, ...aliases] = EmployeeTasksService.pickStaffId(empIds);
    return EmployeeTasksService.ensureTasksForDate(staffId, getVnDateStr(), includeRoomTasks, aliases);
  }

  /** Staff code first (NHxxx), any other id (Users.id) as alias. */
  static pickStaffId(empIds: string[]): string[] {
    const ids = Array.from(new Set(empIds.filter(Boolean)));
    const code = ids.find(id => /^[A-Za-z]{2}\d+/.test(id));
    return code ? [code, ...ids.filter(id => id !== code)] : ids;
  }

  /**
   * Tasks of today + carry-over from yesterday for an employee.
   */
  static async fetchTasks(empIds: string[], _includeRoomTasks: boolean = true) {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const today = getVnDateStr();
    const carryFrom = shiftVnDate(today, -CARRY_OVER_MAX_DAYS);

    const { data, error } = await supabase
      .from('Tasks')
      .select(TASK_FIELDS)
      .in('assignee_id', empIds)
      .eq('task_date', today)
      .is('cancelled_at', null)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Error fetching tasks:', error.message, error.code);
      throw new Error(error.message || 'Failed to fetch tasks');
    }

    const { data: carryOverData } = await supabase
      .from('Tasks')
      .select(TASK_FIELDS)
      .in('assignee_id', empIds)
      .gte('task_date', carryFrom)
      .lt('task_date', today)
      .is('cancelled_at', null)
      .eq('allow_carry_over', true)
      .order('created_at', { ascending: true });
    const carry = (carryOverData || []).filter((t: any) => isCheckoutBlocking(deriveTaskState(t)));

    const all = [...carry, ...(data || [])];
    const taskIds = all.map((t: any) => t.id);
    const photoCounts: Record<string, number> = {};
    if (taskIds.length > 0) {
      const { data: photos } = await supabase
        .from('TaskPhotos')
        .select('task_id')
        .in('task_id', taskIds)
        .eq('is_submitted', true)
        .is('superseded_at', null);
      (photos || []).forEach((p: any) => { photoCounts[p.task_id] = (photoCounts[p.task_id] || 0) + 1; });
    }

    const mapTask = (t: any, isCarryOver: boolean) => {
      const reviews = t.TaskReviews || [];
      const latestReview = reviews.length > 0
        ? [...reviews].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        : null;
      const photoCount = photoCounts[t.id] || 0;
      return {
        id: t.id,
        name: t.name,
        status: t.status === 'COMPLETED' && t.inspection_status === 'REWORK_REQUIRED' ? 'IN_PROGRESS' : t.status,
        inspection_status: t.inspection_status,
        state: deriveTaskState(t, photoCount),
        task_type: t.task_type,
        priority: t.priority,
        completedAt: t.status === 'COMPLETED' ? t.updated_at : null,
        photoCount,
        requires_photo: t.TaskTemplates?.requires_photo ?? true,
        min_photo_count: t.min_photo_count ?? t.TaskTemplates?.min_photo_count ?? 1,
        photo_slots: t.photo_slots,
        evidence_fields: t.evidence_fields,
        evidence_values: t.evidence_values || {},
        standard_text: t.standard_text,
        sop: t.sop,
        time_mode: t.time_mode,
        due_at: t.due_at,
        window_start_at: t.window_start_at,
        window_end_at: t.window_end_at,
        blocks_checkout: t.blocks_checkout,
        requires_review: t.requires_review,
        acceptance_status: t.acceptance_status,
        rejected_slots: t.rejected_slots,
        blocked_reason: t.blocked_reason,
        slot_time: t.slot_time,
        task_date: t.task_date,
        category_id: t.category_id,
        room_id: t.room_id || null,
        categoryName: t.room_id
          ? `Phòng ${t.Rooms?.name ? t.Rooms.name.replace(/Nhà vệ sinh [Ll]ầu /g, 'NVS').replace(/Nhà tắm [Ll]ầu /g, 'NTL') : t.room_id}`
          : (t.TaskCategories?.name || 'Khác'),
        roomHasGuest: t.Rooms?.has_guests || false,
        roomHasGuestUpdatedAt: t.Rooms?.updated_at || null,
        categoryOrder: t.room_id ? 0 : 999,
        sortOrder: t.TaskTemplates?.sort_order || 999,
        isCarryOver,
        carryOverDate: isCarryOver ? t.created_at : undefined,
        reworkNote: latestReview?.note || null,
        reworkPhoto: latestReview?.photo_url || null,
      };
    };

    return { success: true, data: [...carry.map((t: any) => mapTask(t, true)), ...(data || []).map((t: any) => mapTask(t, false))] };
  }

  /**
   * Change task status
   */
  static async updateTaskStatus(taskId: string, status: string, inspectionStatus?: string) {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const updateData: any = { status };
    if (inspectionStatus) {
      updateData.inspection_status = inspectionStatus;
    }

    const { error } = await supabase
      .from('Tasks')
      .update(updateData)
      .eq('id', taskId);

    if (error) {
      console.error('Error updating task status:', error.message, error.code);
      throw new Error('Failed to update task status');
    }

    return { success: true };
  }
}

// ============================================================
// 🚪 CHECKOUT GATE — one source for attendance, attendance status and both on-call routes
// ============================================================

export interface CheckoutBlockers {
  enabled: boolean;
  count: number;
  items: { id: string; name: string; state: TaskState; carry: boolean }[];
  override?: { reason: string; granted_by: string | null } | null;
  error?: boolean;
}

/**
 * Tasks that still keep `staffId` from checking out (today + carry-over from yesterday).
 * Fail-open: any error → no block, only a log line. A broken task module must never
 * leave someone stuck at the end of their shift.
 */
export async function getCheckoutBlockers(
  supabase: any,
  staffId: string,
  workTypeKey: string,
  opts: { ensure?: boolean } = {},
): Promise<CheckoutBlockers> {
  try {
    const { data: cfg } = await supabase
      .from('SystemConfigs')
      .select('value')
      .eq('key', `block_checkout_incomplete_tasks_${workTypeKey}`)
      .maybeSingle();
    if (!cfg?.value) return { enabled: false, count: 0, items: [] };

    const today = getVnDateStr();
    // Generate first on real checkout attempts (closes the "never opened the page" hole).
    // Read-only callers polling the attendance status pass ensure:false.
    if (opts.ensure !== false) {
      try {
        await EmployeeTasksService.ensureTasksForDate(staffId, today);
      } catch (e) {
        console.error('[getCheckoutBlockers] ensureTasksForDate failed:', e);
      }
    }

    const { data: override } = await supabase
      .from('CheckoutOverrides')
      .select('reason, granted_by')
      .eq('staff_id', staffId)
      .eq('business_date', today)
      .maybeSingle();
    if (override) return { enabled: true, count: 0, items: [], override };

    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, task_date, status, inspection_status, requires_review, acceptance_status, cancelled_at, allow_carry_over')
      .eq('assignee_id', staffId)
      .in('task_date', [shiftVnDate(today, -CARRY_OVER_MAX_DAYS), today])
      .eq('blocks_checkout', true)
      .is('cancelled_at', null);
    if (error) throw error;

    const items = (data || [])
      .filter((t: any) => t.task_date === today || t.allow_carry_over)
      .map((t: any) => ({ id: t.id, name: t.name, state: deriveTaskState(t), carry: t.task_date !== today }))
      .filter((t: { state: TaskState }) => isCheckoutBlocking(t.state));

    return { enabled: true, count: items.length, items, override: null };
  } catch (e) {
    console.error('[getCheckoutBlockers] fail-open:', e);
    return { enabled: true, count: 0, items: [], error: true };
  }
}
