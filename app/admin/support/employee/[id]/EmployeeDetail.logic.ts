import { useState, useEffect, useCallback } from 'react';
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
interface RoutineItem {
  id: string;
  templateName: string;
  templateId: string;
  categoryName: string;
  requiresPhoto: boolean;
  minPhotoCount: number;
}

interface TodayTask {
  id: string;
  name: string;
  status: string;
  inspection_status: string;
  task_type: string;
  priority: string;
  completedAt: string | null;
  photoCount: number;
  current_review_round: number;
}

interface TemplateOption {
  id: string;
  name: string;
  categoryName: string;
}

export const useEmployeeDetail = (employeeId: string) => {
  const [employee, setEmployee] = useState<{ id: string; fullName: string; role: string } | null>(null);
  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ============================================================
  // Fetch employee info
  // ============================================================
  const fetchEmployee = useCallback(async () => {
    const { data, error } = await supabase
      .from('Users')
      .select('id, fullName, role')
      .eq('id', employeeId)
      .single();

    if (error) {
      console.error('Error fetching employee:', error.message, error.code);
      return;
    }
    setEmployee(data);
  }, [employeeId]);

  // ============================================================
  // Fetch employee's routines (checklist cố định)
  // ============================================================
  const fetchRoutines = useCallback(async () => {
    const { data, error } = await supabase
      .from('EmployeeRoutines')
      .select('id, template_id, TaskTemplates(id, name, requires_photo, min_photo_count, category_id, TaskCategories(name))')
      .eq('employee_id', employeeId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching routines:', error.message, error.code);
      return;
    }

    const mapped: RoutineItem[] = (data || []).map((r: any) => ({
      id: r.id,
      templateId: r.template_id,
      templateName: r.TaskTemplates?.name || '—',
      categoryName: r.TaskTemplates?.TaskCategories?.name || '—',
      requiresPhoto: r.TaskTemplates?.requires_photo || false,
      minPhotoCount: r.TaskTemplates?.min_photo_count || 1,
    }));

    setRoutines(mapped);
  }, [employeeId]);

  // ============================================================
  // Fetch today's tasks for this employee
  // ============================================================
  const fetchTodayTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, current_review_round, updated_at')
      .eq('assignee_id', employeeId)
      .gte('created_at', TODAY_START.toISOString())
      .lte('created_at', TODAY_END.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching today tasks:', error.message, error.code);
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

    const mapped: TodayTask[] = (data || []).map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      inspection_status: t.inspection_status,
      task_type: t.task_type,
      priority: t.priority,
      completedAt: t.status === 'COMPLETED' ? t.updated_at : null,
      photoCount: photoCounts[t.id] || 0,
      current_review_round: t.current_review_round,
    }));

    setTodayTasks(mapped);
  }, [employeeId]);

  // ============================================================
  // Fetch all templates (for the "Add" modal)
  // ============================================================
  const fetchAvailableTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('TaskTemplates')
      .select('id, name, TaskCategories(name)')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error fetching templates:', error.message, error.code);
      return;
    }

    const mapped: TemplateOption[] = (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      categoryName: t.TaskCategories?.name || '—',
    }));

    setAvailableTemplates(mapped);
  }, []);

  // ============================================================
  // Add routine
  // ============================================================
  const addRoutine = async (templateId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/support/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, templateId }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Error adding routine:', err);
        return;
      }

      await fetchRoutines();
      setShowAddModal(false);
      setSearchQuery('');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Remove routine
  // ============================================================
  const removeRoutine = async (routineId: string) => {
    const res = await fetch(`/api/support/routines?id=${routineId}`, { method: 'DELETE' });
    if (!res.ok) {
      console.error('Error removing routine');
      return;
    }
    await fetchRoutines();
  };

  // ============================================================
  // Review task (PASSED / REWORK_REQUIRED)
  // ============================================================
  const reviewTask = async (taskId: string, decision: 'PASSED' | 'REWORK_REQUIRED', note?: string) => {
    setSubmitting(true);
    try {
      const task = todayTasks.find(t => t.id === taskId);
      if (!task) return;

      const roundNumber = task.current_review_round + 1;

      // 1. Insert review record
      const { error: reviewErr } = await supabase
        .from('TaskReviews')
        .insert({
          task_id: taskId,
          round_number: roundNumber,
          reviewer_id: null, // TODO: Get current admin user
          decision,
          note: note || null,
        });

      if (reviewErr) {
        console.error('Error creating review:', reviewErr.message, reviewErr.code);
        return;
      }

      // 2. Update task status
      const updatePayload: any = {
        current_review_round: roundNumber,
        inspection_status: decision,
      };

      if (decision === 'REWORK_REQUIRED') {
        updatePayload.status = 'IN_PROGRESS';
      }

      const { error: taskErr } = await supabase
        .from('Tasks')
        .update(updatePayload)
        .eq('id', taskId);

      if (taskErr) {
        console.error('Error updating task:', taskErr.message, taskErr.code);
        return;
      }

      // 3. Send notification to employee (REWORK only)
      if (decision === 'REWORK_REQUIRED') {
        const { error: notifErr } = await supabase
          .from('TaskNotifications')
          .insert({
            task_id: taskId,
            employee_id: employeeId,
            type: 'REWORK',
            message: `Quản lý yêu cầu làm lại: ${task.name}${note ? ` — ${note}` : ''}`,
          });

        if (notifErr) {
          console.error('Error sending rework notification:', notifErr.message, notifErr.code);
        }
      }

      await fetchTodayTasks();
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Filtered templates for search
  // ============================================================
  const existingTemplateIds = new Set(routines.map(r => r.templateId));
  const filteredTemplates = availableTemplates.filter(t => {
    if (existingTemplateIds.has(t.id)) return false;
    if (!searchQuery) return true;
    return t.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // ============================================================
  // Init
  // ============================================================
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchEmployee(), fetchRoutines(), fetchTodayTasks(), fetchAvailableTemplates()]);
      setLoading(false);
    };
    init();
  }, [fetchEmployee, fetchRoutines, fetchTodayTasks, fetchAvailableTemplates]);

  // ============================================================
  // Role label helper
  // ============================================================
  const getRoleLabel = (role: string) => {
    const map: Record<string, string> = {
      ADMIN: 'Quản lý',
      RECEPTIONIST: 'Lễ tân',
      TECHNICIAN: 'KTV',
    };
    return map[role] || role;
  };

  return {
    employee,
    routines,
    todayTasks,
    loading,
    showAddModal,
    setShowAddModal,
    searchQuery,
    setSearchQuery,
    filteredTemplates,
    submitting,
    addRoutine,
    removeRoutine,
    reviewTask,
    getRoleLabel,
  };
};
