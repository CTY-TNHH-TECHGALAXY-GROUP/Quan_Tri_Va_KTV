import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { compressImageWithWatermark } from '@/lib/camera.logic';

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
  category_id?: string;
  room_id?: string | null;
  categoryName?: string;
  roomHasGuest?: boolean;
  categoryOrder?: number;
  sortOrder?: number;
  isCarryOver?: boolean;
  carryOverDate?: string;
}

interface TaskNotification {
  id: string;
  message: string;
  type: string;
  created_at: string;
}

import { useAuth } from '@/lib/auth-context';

export const useSupportTasks = () => {
  const { user } = useAuth();
  
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewingTaskPhotos, setViewingTaskPhotos] = useState<{ taskId: string, photos: { id: string, url: string, created_at: string, storage_path: string }[] } | null>(null);
  
  const employeeId = user?.id || null;

  // Track if we already generated today's tasks
  const hasGeneratedRef = useRef(false);

  // ============================================================
  // Fetch today's tasks & Auto-generate via API
  // ============================================================
  const fetchTasks = useCallback(async (empId: string) => {
    try {
      const userCodeParam = user?.code ? `&userCode=${user.code}` : '';
      const res = await fetch(`/api/support/tasks?employeeId=${empId}${userCodeParam}&t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setTasks(json.data || []);
      } else {
        console.error('API error fetching tasks:', json.error);
      }
    } catch (error) {
      console.error('Failed to fetch tasks via API:', error);
    }
  }, []);

  // We can just alias generateTodayTasks to fetchTasks since the GET API does both
  const generateTodayTasks = useCallback(async (empId: string) => {
    if (hasGeneratedRef.current) return;
    hasGeneratedRef.current = true;
    // The fetchTasks will hit the GET endpoint which auto-generates tasks
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
    try {
      const res = await fetch('/api/support/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'START', taskId })
      });
      const json = await res.json();
      if (json.success && employeeId) {
        await fetchTasks(employeeId);
      } else {
        console.error('API error starting task:', json.error);
      }
    } catch (error) {
      console.error('Failed to start task via API:', error);
    }
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

    try {
      const res = await fetch('/api/support/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'COMPLETE', taskId })
      });
      const json = await res.json();
      if (json.success) {
        setSelectedTask(null);
        if (employeeId) await fetchTasks(employeeId);
      } else {
        console.error('API error completing task:', json.error);
      }
    } catch (error) {
      console.error('Failed to complete task via API:', error);
    }
  };

  // ============================================================
  // Toggle Has Guest
  // ============================================================
  const toggleRoomHasGuest = async (roomId: string, currentStatus: boolean) => {
    try {
      // Optimistic UI update
      setTasks(prev => prev.map(t => t.room_id === roomId ? { ...t, roomHasGuest: !currentStatus } : t));
      
      const res = await fetch('/api/rooms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, has_guests: !currentStatus })
      });
      const json = await res.json();
      
      if (!json.success) {
        console.error('API error toggling room guest status:', json.error);
        // Revert on error
        setTasks(prev => prev.map(t => t.room_id === roomId ? { ...t, roomHasGuest: currentStatus } : t));
      }
    } catch (error) {
      console.error('Failed to toggle room guest status via API:', error);
      // Revert on error
      setTasks(prev => prev.map(t => t.room_id === roomId ? { ...t, roomHasGuest: currentStatus } : t));
    }
  };

  // ============================================================
  // Submit Task (Complete)
  // ============================================================
  const submitTask = async (taskId: string) => {
    try {
      const res = await fetch('/api/support/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'COMPLETE', taskId }),
      });
      if (res.ok) {
        await fetchTasks(employeeId!);
      }
    } catch (error) {
      console.error('Failed to submit task:', error);
    }
  };

  // ============================================================
  // Helper: Convert data URI to File
  // ============================================================
  const dataURItoFile = (dataURI: string, filename: string): File => {
    const arr = dataURI.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  // ============================================================
  // Upload photo via API (server-side, bypasses RLS)
  // ============================================================
  const uploadPhoto = async (taskId: string, file: File) => {
    if (!employeeId) return;
    setUploading(true);

    try {
      let finalFile = file;
      try {
        const watermarkText = `Task ${taskId.substring(0, 5)}`;
        const base64 = await compressImageWithWatermark(file, { watermarkText });
        finalFile = dataURItoFile(base64, file.name);
      } catch (err: any) {
        if (err?.message === 'TOO_DARK') {
          alert('⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi đủ ánh sáng.');
          setUploading(false);
          return;
        }
        console.warn('Failed to compress, using original file', err);
      }

      const formData = new FormData();
      formData.append('file', finalFile);
      formData.append('taskId', taskId);
      formData.append('employeeId', employeeId);

      const res = await fetch('/api/support/tasks/upload', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!json.success) {
        console.error('Error uploading photo:', json.error);
        return;
      }

      await fetchTasks(employeeId);
    } catch (error) {
      console.error('Failed to upload photo:', error);
    } finally {
      setUploading(false);
    }
  };

  // ============================================================
  // Fetch Task Photos for viewing
  // ============================================================
  const fetchTaskPhotos = async (taskId: string) => {
    const { data, error } = await supabase
      .from('TaskPhotos')
      .select('id, storage_path, created_at')
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
        return { id: p.id, url: publicUrlData.publicUrl, created_at: p.created_at, storage_path: p.storage_path };
      });
      setViewingTaskPhotos({ taskId, photos: photosWithUrls });
    }
  };

  // ============================================================
  // Delete Photo
  // ============================================================
  const deletePhoto = async (photoId: string, storagePath: string, taskId: string) => {
    try {
      setUploading(true);
      // Delete from storage
      const { error: storageError } = await supabase.storage.from('task-photos').remove([storagePath]);
      if (storageError) {
        console.error('Error deleting from storage:', storageError);
      }
      // Delete from database
      const { error: dbError } = await supabase.from('TaskPhotos').delete().eq('id', photoId);
      if (dbError) throw dbError;

      // Update local state if currently viewing this task's photos
      setViewingTaskPhotos(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        return {
          ...prev,
          photos: prev.photos.filter(p => p.id !== photoId)
        };
      });

      // Update task's photoCount in main list
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, photoCount: Math.max(0, t.photoCount - 1) } : t
      ));
    } catch (err: any) {
      console.error('Failed to delete photo:', err);
      alert('Lỗi khi xoá ảnh: ' + err.message);
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
  // Group tasks by category
  // ============================================================
  
  // Separate carry-over tasks from today's tasks
  const carryOverTasks = tasks.filter(t => t.isCarryOver);
  const todayTasks = tasks.filter(t => !t.isCarryOver);
  
  const urgentTasks = todayTasks.filter(t => t.task_type === 'AD-HOC');
  const normalTasks = todayTasks.filter(t => t.task_type !== 'AD-HOC');

  // Group carry-over tasks by category
  const carryOverGrouped: Record<string, { categoryName: string; categoryOrder: number; carryOverDate: string; tasks: TaskItem[] }> = {};
  carryOverTasks.forEach(t => {
    const groupKey = t.categoryName || 'Khác';
    if (!carryOverGrouped[groupKey]) {
      carryOverGrouped[groupKey] = {
        categoryName: t.categoryName || 'Công việc khác',
        categoryOrder: t.categoryOrder || 999,
        carryOverDate: t.carryOverDate || '',
        tasks: []
      };
    }
    carryOverGrouped[groupKey].tasks.push(t);
  });

  const sortedCarryOver = Object.values(carryOverGrouped).map(cat => ({
    ...cat,
    tasks: cat.tasks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  })).sort((a, b) => {
    if (a.categoryOrder !== b.categoryOrder) return a.categoryOrder - b.categoryOrder;
    return a.categoryName.localeCompare(b.categoryName);
  });

  const groupedTasks: Record<string, { categoryName: string; categoryOrder: number; tasks: TaskItem[] }> = {};
  
  normalTasks.forEach(t => {
    // Use categoryName as group key to ensure room tasks are separated per room
    const groupKey = t.categoryName || `${t.category_id || 'OTHER'}_${t.room_id || 'NOROOM'}`;
    if (!groupedTasks[groupKey]) {
      groupedTasks[groupKey] = {
        categoryName: t.categoryName || 'Công việc khác',
        categoryOrder: t.categoryOrder || 999,
        tasks: []
      };
    }
    groupedTasks[groupKey].tasks.push(t);
  });

  const sortedCategories = Object.values(groupedTasks).map(cat => ({
    ...cat,
    tasks: cat.tasks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  })).sort((a, b) => {
    if (a.categoryOrder !== b.categoryOrder) {
      return a.categoryOrder - b.categoryOrder;
    }
    return a.categoryName.localeCompare(b.categoryName);
  });

  // Progress only counts today's tasks (exclude carry-over)
  const totalTasks = todayTasks.length;
  const doneCount = todayTasks.filter(t => t.status === 'COMPLETED').length;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  return {
    carryOverTasks: sortedCarryOver,
    urgentTasks,
    sortedCategories,
    doneCount,
    totalTasks,
    pct,
    loading,
    notifications,
    dismissNotification,
    uploadPhoto,
    deletePhoto,
    uploading,
    submitTask,
    toggleRoomHasGuest,
    // Photo Viewer State
    viewingTaskPhotos,
    setViewingTaskPhotos,
    fetchTaskPhotos,
  };
};
