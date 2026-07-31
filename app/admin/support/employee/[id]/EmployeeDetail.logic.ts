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
  roomId?: string | null;
  roomName?: string | null;
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
  categoryName?: string;
  categoryOrder?: number;
}

interface TemplateOption {
  id: string;
  templateId: string; // The real template_id
  roomId?: string | null; // null if role task
  name: string;
  categoryId?: string;
  categoryName: string;
}

export const useEmployeeDetail = (employeeId: string) => {
  const [employee, setEmployee] = useState<{ id: string; fullName: string; role: string } | null>(null);
  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAdhocModal, setShowAdhocModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [viewingTaskPhotos, setViewingTaskPhotos] = useState<{ taskId: string, photos: { url: string, created_at: string }[] } | null>(null);

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
      .select('id, template_id, room_id, Rooms(name), TaskTemplates(id, name, requires_photo, min_photo_count, category_id, TaskCategories(name))')
      .eq('employee_id', employeeId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching routines:', error.message, error.code);
      return;
    }

    // Helper function to format room names consistently
    const formatRoomName = (name: string) => {
      if (!name) return '';
      return name.replace(/Nhà vệ sinh [Ll]ầu /g, 'NVS').replace(/Nhà tắm [Ll]ầu /g, 'NTL');
    };

    const mapped: RoutineItem[] = (data || []).map((r: any) => {
      let catName = r.TaskTemplates?.TaskCategories?.name || '—';
      if (r.room_id) {
        catName = `Phòng ${formatRoomName(r.Rooms?.name || r.room_id)}`;
      }

      return {
        id: r.id,
        templateId: r.template_id,
        roomId: r.room_id || null,
        templateName: r.TaskTemplates?.name || '—',
        categoryName: catName,
        roomName: r.Rooms?.name || null,
        requiresPhoto: r.TaskTemplates?.requires_photo || false,
        minPhotoCount: r.TaskTemplates?.min_photo_count || 1,
      };
    });

    setRoutines(mapped);
  }, [employeeId]);

  // ============================================================
  // Fetch today's tasks for this employee
  // ============================================================
  const fetchTodayTasks = useCallback(async () => {
    // 1. Tự động sinh các task mới từ Checklist Cố định (nếu có) thông qua API
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
      await fetch(`/api/support/tasks?employeeId=${employeeId}&t=${Date.now()}`, { 
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Lỗi khi đồng bộ API Tasks:', e);
      }
    }

    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, updated_at, current_review_round, room_id, TaskTemplates(requires_photo, min_photo_count), TaskCategories(name), Rooms(name)')
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

    // Helper function to format room names consistently
    const formatRoomName = (name: string) => {
      if (!name) return '';
      return name.replace(/Nhà vệ sinh [Ll]ầu /g, 'NVS').replace(/Nhà tắm [Ll]ầu /g, 'NTL');
    };

    const mapped: TodayTask[] = (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      inspection_status: t.inspection_status,
      task_type: t.task_type,
      priority: t.priority,
      completedAt: t.status === 'COMPLETED' ? t.updated_at : null,
      photoCount: photoCounts[t.id] || 0,
      current_review_round: t.current_review_round || 0,
      categoryName: t.room_id 
        ? `Phòng ${t.Rooms?.name ? formatRoomName(t.Rooms.name) : t.room_id}` 
        : (t.TaskCategories?.name || 'Khác'),
      categoryOrder: t.room_id ? 0 : 999,
    }));

    setTodayTasks(mapped);
  }, [employeeId]);

  // ============================================================
  // Fetch all templates and group by category
  // ============================================================
  const fetchAvailableTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/support/templates/available');
      if (!res.ok) throw new Error('Failed to fetch available templates');
      
      const { roleData, roomData, success } = await res.json();
      if (!success) throw new Error('API returned success=false');

    const mapped: TemplateOption[] = [];

    // Add generic Role tasks
    (roleData || []).forEach((t: any) => {
      mapped.push({
        id: t.id, // for generic, id is just template_id
        templateId: t.id,
        roomId: null,
        name: t.name,
        categoryId: t.category_id,
        categoryName: t.TaskCategories?.name || 'Chưa phân loại',
      });
    });

    // Add Room specific tasks
    (roomData || []).forEach((r: any) => {
      const t = r.TaskTemplates;
      if (t && t.is_active) {
        mapped.push({
          id: `${t.id}_${r.room_id}`, // unique id for rendering
          templateId: t.id,
          roomId: r.room_id,
          name: t.name,
          categoryId: t.category_id,
          categoryName: `Phòng ${r.Rooms?.name || r.room_id}`,
        });
      }
    });

    // Sort by name
    mapped.sort((a, b) => a.name.localeCompare(b.name));

    setAvailableTemplates(mapped);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  }, []);

  // ==========================================
  // Fetch Task Photos for viewing
  // ==========================================
  const fetchTaskPhotos = async (taskId: string) => {
    const { data, error } = await supabase
      .from('TaskPhotos')
      .select('storage_path, created_at')
      .eq('task_id', taskId)
      .eq('is_submitted', true)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching task photos:', error.message);
      return;
    }

    if (data) {
      const photosWithUrls = data.map((p) => {
        const { data: publicUrlData } = supabase.storage.from('task-photos').getPublicUrl(p.storage_path);
        return { url: publicUrlData.publicUrl, created_at: p.created_at };
      });
      setViewingTaskPhotos({ taskId, photos: photosWithUrls });
    }
  };

  // ============================================================
  // Add routine
  // ============================================================
  const addRoutine = async (templateId: string, roomId?: string | null) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/support/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, templateId, roomId }),
      });

      if (!res.ok) {
        console.error('Error adding routine');
      }

      await fetchRoutines();
      await fetchTodayTasks();
      // DO NOT close modal automatically so user can assign more
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Assign Entire Category
  // ============================================================
  const assignCategory = async (categoryName: string) => {
    setSubmitting(true);
    try {
      const templatesInCategory = availableTemplates.filter(t => t.categoryName === categoryName);
      // Filter out those already assigned
      const unassignedTemplates = templatesInCategory.filter(t => !routines.some(r => r.templateId === t.templateId && r.roomId === t.roomId));
      
      for (const t of unassignedTemplates) {
        await fetch('/api/support/routines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId, templateId: t.templateId, roomId: t.roomId }),
        });
      }

      await fetchRoutines();
      await fetchTodayTasks();
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Unassign Entire Category
  // ============================================================
  const unassignCategory = async (categoryName: string) => {
    setSubmitting(true);
    try {
      const templatesInCategory = availableTemplates.filter(t => t.categoryName === categoryName);
      const routinesToRemove = routines.filter(r => templatesInCategory.some(t => t.templateId === r.templateId && t.roomId === r.roomId));
      
      for (const r of routinesToRemove) {
        await fetch(`/api/support/routines?id=${r.id}`, { method: 'DELETE' });
      }

      await fetchRoutines();
      await fetchTodayTasks();
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
    await fetchTodayTasks();
  };

  // ============================================================
  // Create Ad-hoc Task
  // ============================================================
  const createAdhocTask = async (name: string) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('Tasks').insert({
        name,
        assignee_id: employeeId,
        task_type: 'AD-HOC',
        priority: 'HIGH',
        status: 'NOT_STARTED',
        inspection_status: 'NOT_REVIEWED',
      });
      
      if (error) {
        console.error('Error creating adhoc task:', error.message);
        return;
      }
      
      await fetchTodayTasks();
      setShowAdhocModal(false);
    } finally {
      setSubmitting(false);
    }
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

      // 3. Send notification to employee and delete old photos (REWORK only)
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

        // Call API to delete photos from storage and DB
        try {
          await fetch('/api/support/tasks/rework', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId }),
          });
        } catch (apiErr) {
          console.error('Error calling rework API:', apiErr);
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
  const existingTemplateIds = new Set(routines.map(r => `${r.templateId}_${r.roomId || ''}`));
  const filteredTemplates = availableTemplates.filter(t => {
    if (existingTemplateIds.has(`${t.templateId}_${t.roomId || ''}`)) return false;
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
    availableTemplates,
    loading,
    showAddModal,
    showAdhocModal,
    setShowAdhocModal,
    setShowAddModal,
    searchQuery,
    setSearchQuery,
    filteredTemplates,
    submitting,
    viewingTaskPhotos,
    setViewingTaskPhotos,
    fetchTaskPhotos,
    addRoutine,
    assignCategory,
    unassignCategory,
    removeRoutine,
    createAdhocTask,
    reviewTask,
    getRoleLabel,
  };
};
