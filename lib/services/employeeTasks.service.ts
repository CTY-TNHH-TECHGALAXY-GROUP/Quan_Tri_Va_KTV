import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// ============================================================
// 🔧 CONSTANTS
// ============================================================
const getTodayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const getTodayEnd = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const shouldGenerateTaskToday = (repeatMode: string, cronSchedule?: string | null) => {
  if (!repeatMode || repeatMode === 'DAILY') return true;
  
  const today = new Date();
  const day = today.getDay(); // 0 is Sunday, 1 is Monday
  
  if (repeatMode === 'WEEKLY_MONDAY' && day === 1) return true;
  if (repeatMode === 'WEEKLY_TUESDAY' && day === 2) return true;
  if (repeatMode === 'WEEKLY_WEDNESDAY' && day === 3) return true;
  if (repeatMode === 'WEEKLY_THURSDAY' && day === 4) return true;
  if (repeatMode === 'WEEKLY_FRIDAY' && day === 5) return true;
  if (repeatMode === 'WEEKLY_SATURDAY' && day === 6) return true;
  if (repeatMode === 'WEEKLY_SUNDAY' && day === 0) return true;
  
  if (repeatMode === 'WEEKLY' && cronSchedule) {
    const days = cronSchedule.split(',').map(Number);
    if (days.includes(day)) return true;
  }
  
  return false;
};

export class EmployeeTasksService {
  /**
   * Auto-generate tasks for an employee based on their active routines
   */
  static async generateTodayTasks(empIds: string[]) {
    const todayStart = getTodayStart();
    const todayEnd = getTodayEnd();
    
    // Get YYYY-MM-DD for date-based queries
    const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD'

    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    // Check if employee is on leave today
    const { data: leaveData } = await supabase
      .from('KTVLeaveRequests')
      .select('id')
      .in('employeeId', empIds)
      .eq('date', todayStr)
      .eq('status', 'APPROVED');
      
    if (leaveData && leaveData.length > 0) {
      console.log(`Employee(s) ${empIds.join(', ')} is on leave today. Skipping task generation.`);
      return { success: true, count: 0, reason: 'ON_LEAVE' };
    }

    const { data: dailyAtt } = await supabase
      .from('DailyAttendance')
      .select('status')
      .in('employee_id', empIds)
      .eq('date', todayStr);
      
    if (dailyAtt && dailyAtt.some(att => att.status === 'absent' || att.status === 'off_leave' || att.status === 'off_duty')) {
      console.log(`Employee(s) ${empIds.join(', ')} attendance status is off. Skipping task generation.`);
      return { success: true, count: 0, reason: 'OFF_DUTY' };
    }

    // Check if tasks already exist for today
    const { data: existing, error: err1 } = await supabase
      .from('Tasks')
      .select('id, template_id, room_id, assignee_id')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);

    if (err1) {
      console.error('Error fetching existing tasks:', err1.message, err1.code);
      throw new Error('Failed to fetch existing tasks');
    }

    const existingTemplateIds = new Set((existing || []).filter(t => t.assignee_id !== null).map(t => t.template_id));
    const existingRoomTemplates = new Set((existing || []).filter(t => t.room_id !== null).map(t => `${t.template_id}_${t.room_id}`));

    // Fetch routines
    const { data: routines, error: err2 } = await supabase
      .from('EmployeeRoutines')
      .select('template_id, TaskTemplates(id, name, category_id, requires_photo, min_photo_count, sort_order, cron_schedule, TaskCategories(repeat_mode))')
      .in('employee_id', empIds)
      .eq('is_active', true);

    if (err2) {
      console.error('Error fetching routines:', err2.message, err2.code);
      throw new Error('Failed to fetch routines');
    }

    if (!routines || routines.length === 0) return { success: true, count: 0 };

    // Create missing tasks
    const newTasks = routines
      .filter((r: any) => {
        if (existingTemplateIds.has(r.template_id)) return false;
        const repeatMode = r.TaskTemplates?.TaskCategories?.repeat_mode || 'DAILY';
        const cronSchedule = r.TaskTemplates?.cron_schedule;
        return shouldGenerateTaskToday(repeatMode, cronSchedule);
      })
      .map((r: any) => ({
        template_id: r.template_id,
        category_id: r.TaskTemplates?.category_id || null,
        name: r.TaskTemplates?.name || 'Công việc',
        task_type: 'FIXED',
        assignee_id: empIds[0], // Use the primary ID (UUID) for assignment
        status: 'NOT_STARTED',
        inspection_status: 'NOT_REVIEWED',
        priority: 'NORMAL',
        sort_order: r.TaskTemplates?.sort_order || 0
      }));

    // Fetch Room tasks
    const { data: roomRoutines } = await supabase
      .from('RoomTaskTemplates')
      .select('template_id, room_id, TaskTemplates(id, name, category_id, requires_photo, min_photo_count, sort_order, cron_schedule, TaskCategories(repeat_mode))');

    if (roomRoutines && roomRoutines.length > 0) {
      const newRoomTasks = roomRoutines
        .filter((r: any) => {
          if (existingRoomTemplates.has(`${r.template_id}_${r.room_id}`)) return false;
          const repeatMode = r.TaskTemplates?.TaskCategories?.repeat_mode || 'DAILY';
          const cronSchedule = r.TaskTemplates?.cron_schedule;
          return shouldGenerateTaskToday(repeatMode, cronSchedule);
        })
        .map((r: any) => ({
          template_id: r.template_id,
          room_id: r.room_id,
          category_id: r.TaskTemplates?.category_id || null,
          name: r.TaskTemplates?.name || 'Công việc phòng',
          task_type: 'FIXED',
          assignee_id: null, // Shared room task
          status: 'NOT_STARTED',
          inspection_status: 'NOT_REVIEWED',
          priority: 'NORMAL',
          sort_order: r.TaskTemplates?.sort_order || 0
        }));

      newTasks.push(...newRoomTasks);
    }

    if (newTasks.length > 0) {
      const { error: insertErr } = await supabase.from('Tasks').insert(newTasks);
      if (insertErr) {
        console.warn('Warning: Could not insert some generated tasks. This usually happens if the user is not in the Staff table.', insertErr.message);
        // We do NOT throw here, we just continue so the API can still return the empty array or existing tasks.
      }
    }

    return { success: true, count: newTasks.length };
  }

  /**
   * Fetch all tasks for an employee today
   */
  static async fetchTasks(empIds: string[]) {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const todayStart = getTodayStart();
    const todayEnd = getTodayEnd();

    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, template_id, category_id, room_id, updated_at, TaskTemplates(requires_photo, min_photo_count, sort_order), TaskCategories(name)')
      .or(`assignee_id.in.(${empIds.join(',')}),room_id.not.is.null`)
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching tasks:', error.message, error.code);
      throw new Error(error.message || 'Failed to fetch tasks');
    }

    // Fetch photo counts
    const taskIds = (data || []).map(t => t.id);
    let photoCounts: Record<string, number> = {};

    if (taskIds.length > 0) {
      const { data: photos, error: photoErr } = await supabase
        .from('TaskPhotos')
        .select('task_id')
        .in('task_id', taskIds)
        .eq('is_submitted', true);

      if (!photoErr) {
        (photos || []).forEach(p => {
          photoCounts[p.task_id] = (photoCounts[p.task_id] || 0) + 1;
        });
      }
    }

    const mapped = (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      inspection_status: t.inspection_status,
      task_type: t.task_type,
      priority: t.priority,
      completedAt: t.status === 'COMPLETED' ? t.updated_at : null,
      photoCount: photoCounts[t.id] || 0,
      requires_photo: t.TaskTemplates?.requires_photo || false,
      min_photo_count: t.TaskTemplates?.min_photo_count || 1,
      category_id: t.category_id,
      categoryName: t.room_id ? `[Phòng ${t.room_id}] ${t.TaskCategories?.name || 'Khác'}` : (t.TaskCategories?.name || 'Khác'),
      categoryOrder: 999,
      sortOrder: t.TaskTemplates?.sort_order || 999,
    }));

    return { success: true, data: mapped };
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
