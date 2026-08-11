import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================================
// 🔧 UI CONFIGURATION
// ============================================================
const getVietnamTime = () => {
  return new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
};

const getTodayStart = () => {
  const d = getVietnamTime();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const getTodayEnd = () => {
  const d = getVietnamTime();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const CARRY_OVER_MAX_DAYS = 1;
const getCarryOverStart = () => {
  const d = getVietnamTime();
  d.setDate(d.getDate() - CARRY_OVER_MAX_DAYS);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

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
  isCarryOver?: boolean;
  carryOverDate?: string;
  roomHasGuest?: boolean;
  roomHasGuestUpdatedAt?: string | null;
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
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const [viewingTaskPhotos, setViewingTaskPhotos] = useState<{ 
    title: string; 
    currentIndex: number; 
    photos: { url: string; created_at: string; taskName: string }[] 
  } | null>(null);

  const toggleCategory = (catName: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [catName]: !prev[catName]
    }));
  };

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

    // Fetch custom photo counts from matrix
    const { data: matrixData } = await supabase
      .from('RoomTaskTemplates')
      .select('template_id, room_id, custom_min_photo_count');
      
    const customPhotoMap = new Map<string, number>();
    (matrixData || []).forEach(m => {
      if (m.custom_min_photo_count !== null && m.custom_min_photo_count !== undefined) {
        customPhotoMap.set(`${m.template_id}_${m.room_id}`, m.custom_min_photo_count);
      }
    });

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
        minPhotoCount: customPhotoMap.get(`${r.template_id}_${r.room_id}`) ?? r.TaskTemplates?.min_photo_count ?? 1,
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
      .select('id, name, status, inspection_status, task_type, priority, updated_at, current_review_round, room_id, TaskTemplates(requires_photo, min_photo_count), TaskCategories(name), Rooms(name, has_guests)')
      .eq('assignee_id', employeeId)
      .gte('created_at', getTodayStart())
      .lte('created_at', getTodayEnd())
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
      roomHasGuest: t.Rooms?.has_guests || false,
    }));

    setTodayTasks(mapped);

    // Fetch carry-over tasks from previous days
    const { data: carryOverData } = await supabase
      .from('Tasks')
      .select('id, name, status, inspection_status, task_type, priority, updated_at, current_review_round, room_id, created_at, TaskTemplates(requires_photo, min_photo_count), TaskCategories(name), Rooms(name, has_guests)')
      .eq('assignee_id', employeeId)
      .gte('created_at', getCarryOverStart())
      .lt('created_at', getTodayStart())
      .or('status.in.(NOT_STARTED,IN_PROGRESS),and(status.eq.COMPLETED,inspection_status.in.(REWORK_REQUIRED,PENDING_REVIEW))')
      .order('created_at', { ascending: true });

    if (carryOverData && carryOverData.length > 0) {
      const coTaskIds = carryOverData.map(t => t.id);
      let coPhotoCounts: Record<string, number> = {};
      const { data: coPhotos } = await supabase
        .from('TaskPhotos')
        .select('task_id')
        .in('task_id', coTaskIds)
        .eq('is_submitted', true);
      (coPhotos || []).forEach(p => {
        coPhotoCounts[p.task_id] = (coPhotoCounts[p.task_id] || 0) + 1;
      });

      const carryOverMapped: TodayTask[] = carryOverData.map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status === 'COMPLETED' && t.inspection_status === 'REWORK_REQUIRED' ? 'IN_PROGRESS' : t.status,
        inspection_status: t.inspection_status,
        task_type: t.task_type,
        priority: t.priority,
        completedAt: null,
        photoCount: coPhotoCounts[t.id] || 0,
        current_review_round: t.current_review_round || 0,
        categoryName: t.room_id
          ? `Phòng ${t.Rooms?.name ? formatRoomName(t.Rooms.name) : t.room_id}`
          : (t.TaskCategories?.name || 'Khác'),
        categoryOrder: t.room_id ? 0 : 999,
        roomHasGuest: t.Rooms?.has_guests || false,
        isCarryOver: true,
        carryOverDate: t.created_at,
      }));

      setTodayTasks(prev => [...carryOverMapped, ...prev]);
    }
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
  const fetchTaskPhotos = async (taskId: string, taskName?: string) => {
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
      const task = todayTasks.find(t => t.id === taskId);
      const name = taskName || task?.name || 'Công việc';
      const photosWithUrls = data.map((p) => {
        const { data: publicUrlData } = supabase.storage.from('task-photos').getPublicUrl(p.storage_path);
        return { url: publicUrlData.publicUrl, created_at: p.created_at, taskName: name };
      });
      setViewingTaskPhotos({ title: name, currentIndex: 0, photos: photosWithUrls });
    }
  };

  // ==========================================
  // Fetch ALL photos for a group/room (Carousel)
  // ==========================================
  const fetchGroupPhotos = async (groupTitle: string, tasks: TodayTask[]) => {
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length === 0) return;

    const { data, error } = await supabase
      .from('TaskPhotos')
      .select('task_id, storage_path, created_at')
      .in('task_id', taskIds)
      .eq('is_submitted', true)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching group photos:', error.message);
      return;
    }

    if (data && data.length > 0) {
      // Build task name map
      const taskNameMap: Record<string, string> = {};
      tasks.forEach(t => { taskNameMap[t.id] = t.name; });

      const photosWithUrls = data.map((p) => {
        const { data: publicUrlData } = supabase.storage.from('task-photos').getPublicUrl(p.storage_path);
        return {
          url: publicUrlData.publicUrl,
          created_at: p.created_at,
          taskName: taskNameMap[p.task_id] || 'Công việc',
        };
      });
      setViewingTaskPhotos({ title: groupTitle, currentIndex: 0, photos: photosWithUrls });
    }
  };

  // ==========================================
  // Carousel navigation
  // ==========================================
  const goToNextPhoto = () => {
    setViewingTaskPhotos(prev => {
      if (!prev || prev.photos.length === 0) return prev;
      return { ...prev, currentIndex: (prev.currentIndex + 1) % prev.photos.length };
    });
  };

  const goToPrevPhoto = () => {
    setViewingTaskPhotos(prev => {
      if (!prev || prev.photos.length === 0) return prev;
      return { ...prev, currentIndex: (prev.currentIndex - 1 + prev.photos.length) % prev.photos.length };
    });
  };

  // ==========================================
  // Batch review: Approve all pending tasks
  // ==========================================
  const reviewAllPending = async (tasks: TodayTask[]) => {
    const pending = tasks.filter(t => 
      t.status === 'COMPLETED' && 
      (t.inspection_status === 'PENDING_REVIEW' || t.inspection_status === 'NOT_REVIEWED')
    );
    if (pending.length === 0) return;

    setSubmitting(true);
    try {
      const pendingIds = pending.map(t => t.id);

      // 1. Batch update tasks
      const { error: taskErr } = await supabase
        .from('Tasks')
        .update({ inspection_status: 'PASSED' })
        .in('id', pendingIds);

      if (taskErr) {
        console.error('Error batch reviewing:', taskErr.message);
        return;
      }

      // 2. Batch insert reviews
      const reviews = pending.map(t => ({
        task_id: t.id,
        round_number: (t.current_review_round || 0) + 1,
        reviewer_id: null,
        decision: 'PASSED' as const,
        note: 'Duyệt hàng loạt',
      }));

      await supabase.from('TaskReviews').insert(reviews);

      // 3. Refresh UI
      await fetchTodayTasks();
    } finally {
      setSubmitting(false);
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
        const err = await res.json();
        console.error('Error adding routine:', err);
        alert('Lỗi khi gán công việc: ' + (err.error || 'Unknown'));
        return;
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
  const reviewTask = async (taskId: string, decision: 'PASSED' | 'REWORK_REQUIRED', note?: string, currentReviewFile?: File | null) => {
    setSubmitting(true);
    try {
      const task = todayTasks.find(t => t.id === taskId);
      if (!task) return;

      const roundNumber = task.current_review_round + 1;

      // 0. Upload review photo if needed
      let uploadedPhotoUrl: string | null = null;
      if (decision === 'REWORK_REQUIRED' && currentReviewFile) {
        const formData = new FormData();
        formData.append('file', currentReviewFile);
        
        const res = await fetch('/api/support/tasks/rework-photo', {
          method: 'POST',
          body: formData
        });
        const json = await res.json();
        
        if (!json.success) {
          console.error('Error uploading review photo:', json.error);
          alert('Lỗi tải ảnh lên: ' + json.error);
          setSubmitting(false);
          return;
        }
        uploadedPhotoUrl = json.path;
      }

      // 1. Insert review record
      const { error: reviewErr } = await supabase
        .from('TaskReviews')
        .insert({
          task_id: taskId,
          round_number: roundNumber,
          reviewer_id: null, // TODO: Get current admin user
          decision,
          note: note || null,
          photo_url: uploadedPhotoUrl,
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

  // ============================================================
  // Delete task
  // ============================================================
  const deleteTask = async (taskId: string) => {
    if (!confirm('Bạn có chắc muốn xóa công việc này?')) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('Tasks').delete().eq('id', taskId);
      if (error) {
        console.error('Error deleting task:', error.message);
        alert('Lỗi xóa công việc: ' + error.message);
        return;
      }
      await fetchTodayTasks();
    } finally {
      setSubmitting(false);
    }
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
    expandedCategories,
    toggleCategory,
    reviewFile,
    setReviewFile,
    viewingTaskPhotos,
    setViewingTaskPhotos,
    fetchTaskPhotos,
    fetchGroupPhotos,
    goToNextPhoto,
    goToPrevPhoto,
    reviewAllPending,
    addRoutine,
    assignCategory,
    unassignCategory,
    removeRoutine,
    createAdhocTask,
    reviewTask,
    deleteTask,
    getRoleLabel,
  };
};
