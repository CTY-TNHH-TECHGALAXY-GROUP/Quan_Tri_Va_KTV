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

export class EmployeeTasksService {
  /**
   * Auto-generate tasks for an employee based on their active routines
   */
  static async generateTodayTasks(empId: string) {
    const todayStart = getTodayStart();
    const todayEnd = getTodayEnd();

    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    // Check if tasks already exist for today
    const { data: existing, error: err1 } = await supabase
      .from('Tasks')
      .select('id, template_id')
      .eq('assignee_id', empId)
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);

    if (err1) {
      console.error('Error fetching existing tasks:', err1.message, err1.code);
      throw new Error('Failed to fetch existing tasks');
    }

    const existingTemplateIds = new Set((existing || []).map(t => t.template_id));

    // Fetch routines
    const { data: routines, error: err2 } = await supabase
      .from('EmployeeRoutines')
      .select('template_id, TaskTemplates(id, name, category_id, requires_photo, min_photo_count)')
      .eq('employee_id', empId)
      .eq('is_active', true);

    if (err2) {
      console.error('Error fetching routines:', err2.message, err2.code);
      throw new Error('Failed to fetch routines');
    }

    if (!routines || routines.length === 0) return { success: true, count: 0 };

    // Create missing tasks
    const newTasks = routines
      .filter((r: any) => !existingTemplateIds.has(r.template_id))
      .map((r: any) => ({
        template_id: r.template_id,
        category_id: r.TaskTemplates?.category_id || null,
        name: r.TaskTemplates?.name || 'Công việc',
        task_type: 'FIXED',
        assignee_id: empId,
        status: 'NOT_STARTED',
        inspection_status: 'NOT_REVIEWED',
        priority: 'NORMAL',
      }));

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
  static async fetchTasks(empId: string) {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const todayStart = getTodayStart();
    const todayEnd = getTodayEnd();

    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, template_id, updated_at, TaskTemplates(requires_photo, min_photo_count)')
      .eq('assignee_id', empId)
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching tasks:', error.message, error.code);
      throw new Error('Failed to fetch tasks');
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
