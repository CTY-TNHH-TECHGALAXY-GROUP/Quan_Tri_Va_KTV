import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================================
// 🔧 UI CONFIGURATION
// ============================================================
const TODAY_START = new Date();
TODAY_START.setHours(0, 0, 0, 0);

const TODAY_END = new Date();
TODAY_END.setHours(23, 59, 59, 999);

// ============================================================
// Types
// ============================================================
interface TaskItem {
  id: string;
  name: string;
  status: string;
  inspection_status: string;
  task_type: string;
  priority: string;
  completedAt: string | null;
  photoCount: number;
  requires_photo: boolean;
  min_photo_count: number;
}

interface TaskNotification {
  id: string;
  message: string;
  type: string;
  created_at: string;
}

export const useSupportTasks = () => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  // Track if we already generated today's tasks
  const hasGeneratedRef = useRef(false);

  // ============================================================
  // Get current logged-in employee ID
  // ============================================================
  useEffect(() => {
    const storedUser = localStorage.getItem('userData');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setEmployeeId(parsed.id || parsed.code || null);
      } catch {
        console.error('Error parsing userData from localStorage');
      }
    }
  }, []);

  // ============================================================
  // Auto-generate today's tasks from EmployeeRoutines
  // ============================================================
  const generateTodayTasks = useCallback(async (empId: string) => {
    if (hasGeneratedRef.current) return;
    hasGeneratedRef.current = true;

    // Check if tasks already exist for today
    const { data: existing } = await supabase
      .from('Tasks')
      .select('id, template_id')
      .eq('assignee_id', empId)
      .gte('created_at', TODAY_START.toISOString())
      .lte('created_at', TODAY_END.toISOString());

    const existingTemplateIds = new Set((existing || []).map(t => t.template_id));

    // Fetch routines
    const { data: routines } = await supabase
      .from('EmployeeRoutines')
      .select('template_id, TaskTemplates(id, name, category_id, requires_photo, min_photo_count)')
      .eq('employee_id', empId)
      .eq('is_active', true);

    if (!routines || routines.length === 0) return;

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
      const { error } = await supabase.from('Tasks').insert(newTasks);
      if (error) {
        console.error('Error generating tasks:', error.message, error.code);
      }
    }
  }, []);

  // ============================================================
  // Fetch today's tasks
  // ============================================================
  const fetchTasks = useCallback(async (empId: string) => {
    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, template_id, updated_at, TaskTemplates(requires_photo, min_photo_count)')
      .eq('assignee_id', empId)
      .gte('created_at', TODAY_START.toISOString())
      .lte('created_at', TODAY_END.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching tasks:', error.message, error.code);
      return;
    }

    // Fetch photo counts
    const taskIds = (data || []).map(t => t.id);
    let photoCounts: Record<string, number> = {};

    if (taskIds.length > 0) {
      const { data: photos } = await supabase
        .from('TaskPhotos')
        .select('task_id')
        .in('task_id', taskIds)
        .eq('is_submitted', true);

      (photos || []).forEach(p => {
        photoCounts[p.task_id] = (photoCounts[p.task_id] || 0) + 1;
      });
    }

    const mapped: TaskItem[] = (data || []).map((t: any) => ({
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

    setTasks(mapped);
  }, []);

  // ============================================================
  // Fetch unread notifications
  // ============================================================
  const fetchNotifications = useCallback(async (empId: string) => {
    const { data, error } = await supabase
      .from('TaskNotifications')
      .select('*')
      .eq('employee_id', empId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching task notifications:', error.message, error.code);
      return;
    }
    setNotifications(data || []);
  }, []);

  // ============================================================
  // Mark notification as read
  // ============================================================
  const dismissNotification = async (notifId: string) => {
    await supabase.from('TaskNotifications').update({ is_read: true }).eq('id', notifId);
    setNotifications(prev => prev.filter(n => n.id !== notifId));
  };

  // ============================================================
  // Start task
  // ============================================================
  const startTask = async (taskId: string) => {
    const { error } = await supabase
      .from('Tasks')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', taskId);

    if (error) {
      console.error('Error starting task:', error.message, error.code);
      return;
    }

    if (employeeId) await fetchTasks(employeeId);
  };

  // ============================================================
  // Complete task
  // ============================================================
  const completeTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && task.requires_photo && task.photoCount < task.min_photo_count) {
      alert(`Cần chụp tối thiểu ${task.min_photo_count} ảnh trước khi hoàn thành.`);
      return;
    }

    const { error } = await supabase
      .from('Tasks')
      .update({ status: 'COMPLETED', inspection_status: 'PENDING_REVIEW' })
      .eq('id', taskId);

    if (error) {
      console.error('Error completing task:', error.message, error.code);
      return;
    }

    setSelectedTask(null);
    if (employeeId) await fetchTasks(employeeId);
  };

  // ============================================================
  // Upload photo (draft / auto-save)
  // ============================================================
  const uploadPhoto = async (taskId: string, file: File) => {
    if (!employeeId) return;
    setUploading(true);

    try {
      const fileName = `tasks/${taskId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from('task-photos')
        .upload(fileName, file);

      if (uploadErr) {
        console.error('Error uploading photo:', uploadErr.message);
        return;
      }

      const { error: insertErr } = await supabase
        .from('TaskPhotos')
        .insert({
          task_id: taskId,
          uploaded_by: employeeId,
          storage_path: fileName,
          is_submitted: true,
          review_round: 0,
        });

      if (insertErr) {
        console.error('Error saving photo record:', insertErr.message, insertErr.code);
        return;
      }

      await fetchTasks(employeeId);
    } finally {
      setUploading(false);
    }
  };

  // ============================================================
  // Initialize
  // ============================================================
  useEffect(() => {
    if (!employeeId) return;

    const init = async () => {
      setLoading(true);
      await generateTodayTasks(employeeId);
      await Promise.all([fetchTasks(employeeId), fetchNotifications(employeeId)]);
      setLoading(false);
    };

    init();
  }, [employeeId, generateTodayTasks, fetchTasks, fetchNotifications]);

  // ============================================================
  // Realtime: Listen to TaskNotifications
  // ============================================================
  useEffect(() => {
    if (!employeeId) return;

    const channel = supabase
      .channel('task-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'TaskNotifications',
          filter: `employee_id=eq.${employeeId}`,
        },
        (payload) => {
          const newNotif = payload.new as TaskNotification;
          setNotifications(prev => [newNotif, ...prev]);
          // Refresh tasks (in case of rework)
          fetchTasks(employeeId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employeeId, fetchTasks]);

  // ============================================================
  // Sort tasks: AD-HOC first → Not completed → Completed
  // ============================================================
  const urgentTasks = tasks.filter(t => t.task_type === 'AD-HOC' && t.status !== 'COMPLETED');
  const incompleteTasks = tasks.filter(t => t.task_type !== 'AD-HOC' && t.status !== 'COMPLETED');
  const completedTasks = tasks.filter(t => t.status === 'COMPLETED');

  const totalTasks = tasks.length;
  const doneCount = completedTasks.length;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  return {
    urgentTasks,
    incompleteTasks,
    completedTasks,
    notifications,
    totalTasks,
    doneCount,
    pct,
    loading,
    selectedTask,
    setSelectedTask,
    uploading,
    startTask,
    completeTask,
    uploadPhoto,
    dismissNotification,
  };
};
