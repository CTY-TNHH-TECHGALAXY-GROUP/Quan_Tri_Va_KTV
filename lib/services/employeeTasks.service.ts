import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// ============================================================
// 🔧 CONSTANTS
// ============================================================
const getVietnamTime = () => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (7 * 60 * 60 * 1000));
};

const getTodayStart = () => {
  const vnTime = getVietnamTime();
  vnTime.setHours(0, 0, 0, 0);
  return new Date(vnTime.getTime() - (7 * 60 * 60 * 1000)).toISOString();
};

const getTodayEnd = () => {
  const vnTime = getVietnamTime();
  vnTime.setHours(23, 59, 59, 999);
  return new Date(vnTime.getTime() - (7 * 60 * 60 * 1000)).toISOString();
};

const shouldGenerateTaskToday = (repeatMode: string, cronSchedule?: string | null) => {
  if (!repeatMode || repeatMode === 'DAILY') return true;
  
  const vnTime = getVietnamTime();
  const day = vnTime.getDay(); // 0 is Sunday, 1 is Monday
  
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
  static async generateTodayTasks(empIds: string[], includeRoomTasks: boolean = true) {
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
      .select('id, template_id, room_id, assignee_id, status, task_type')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);

    if (err1) {
      console.error('Error fetching existing tasks:', err1.message, err1.code);
      throw new Error('Failed to fetch existing tasks');
    }

    const existingRoutineIds = new Set((existing || []).filter(t => t.assignee_id !== null).map(t => `${t.template_id}_${t.room_id || ''}`));
    const existingRoomTemplates = new Set((existing || []).filter(t => t.room_id !== null).map(t => `${t.template_id}_${t.room_id}`));

    // Fetch routines
    const { data: routines, error: err2 } = await supabase
      .from('EmployeeRoutines')
      .select('template_id, room_id, TaskTemplates(id, name, category_id, requires_photo, min_photo_count, sort_order, cron_schedule, TaskCategories(repeat_mode))')
      .in('employee_id', empIds)
      .eq('is_active', true);

    if (err2) {
      console.error('Error fetching routines:', err2.message, err2.code);
      throw new Error('Failed to fetch routines');
    }

    const activeRoutineIds = new Set((routines || []).map(r => `${r.template_id}_${r.room_id || ''}`));

    // Cleanup stale FIXED tasks that are NO LONGER in the employee's active routines
    const staleTasks = (existing || []).filter(t => 
      t.assignee_id && empIds.includes(t.assignee_id) && // Belongs to this employee
      t.task_type === 'FIXED' && // Auto-generated
      t.status === 'NOT_STARTED' && // Hasn't started
      t.template_id && // Has a template
      !activeRoutineIds.has(`${t.template_id}_${t.room_id || ''}`) // Template is no longer assigned
    );

    if (staleTasks.length > 0) {
      const staleTaskIds = staleTasks.map(t => t.id);
      const { error: deleteErr } = await supabase.from('Tasks').delete().in('id', staleTaskIds);
      if (deleteErr) {
        console.error('Error deleting stale tasks:', deleteErr.message);
      } else {
        console.log(`Cleaned up ${staleTasks.length} stale tasks for employee(s) ${empIds.join(', ')}`);
      }
    }

    if (!routines || routines.length === 0) return { success: true, count: 0 };

    // Create missing tasks
    const newTasks: any[] = routines
      .filter((r: any) => {
        if (!r.TaskTemplates || r.TaskTemplates.is_active === false) return false;
        if (existingRoutineIds.has(`${r.template_id}_${r.room_id || ''}`)) return false;
        const repeatMode = r.TaskTemplates?.TaskCategories?.repeat_mode || 'DAILY';
        const cronSchedule = r.TaskTemplates?.cron_schedule;
        return shouldGenerateTaskToday(repeatMode, cronSchedule);
      })
      .map((r: any) => {
        if (r.room_id) {
          existingRoomTemplates.add(`${r.template_id}_${r.room_id}`);
        }
        return {
          template_id: r.template_id,
          room_id: r.room_id || null,
          category_id: r.TaskTemplates?.category_id || null,
          name: r.TaskTemplates?.name || 'Công việc',
          task_type: 'FIXED',
          assignee_id: empIds[0], // Use the primary ID (UUID) for assignment
          status: 'NOT_STARTED',
          inspection_status: 'NOT_REVIEWED',
          priority: 'NORMAL',
          sort_order: r.TaskTemplates?.sort_order || 0
        };
      });

    if (includeRoomTasks) {
      // Fetch Room tasks
      const { data: roomRoutines } = await supabase
        .from('RoomTaskTemplates')
        .select('template_id, room_id, TaskTemplates(id, name, category_id, requires_photo, min_photo_count, sort_order, cron_schedule, TaskCategories(repeat_mode))');

      if (roomRoutines && roomRoutines.length > 0) {
        const newRoomTasks = roomRoutines
          .filter((r: any) => {
            if (!r.TaskTemplates || r.TaskTemplates.is_active === false) return false;
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
  static async fetchTasks(empIds: string[], includeRoomTasks: boolean = true) {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const todayStart = getTodayStart();
    const todayEnd = getTodayEnd();

    let query = supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, template_id, category_id, room_id, updated_at, TaskTemplates(requires_photo, min_photo_count, sort_order), TaskCategories(name), Rooms(name)')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .order('created_at', { ascending: true });

    if (includeRoomTasks) {
      query = query.or(`assignee_id.in.(${empIds.join(',')}),room_id.not.is.null`);
    } else {
      query = query.in('assignee_id', empIds);
    }

    const { data, error } = await query;

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
      categoryName: t.room_id ? `Phòng ${t.Rooms?.name ? t.Rooms.name.replace(/Nhà vệ sinh [Ll]ầu /g, 'NVS').replace(/Nhà tắm [Ll]ầu /g, 'NTL') : t.room_id}` : (t.TaskCategories?.name || 'Khác'),
      categoryOrder: t.room_id ? 0 : 999,
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
