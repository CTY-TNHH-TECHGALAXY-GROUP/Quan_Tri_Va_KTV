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
  category_id?: string;
  categoryName?: string;
  categoryOrder?: number;
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
  
  const employeeId = user?.code || user?.id || null;

  // Track if we already generated today's tasks
  const hasGeneratedRef = useRef(false);

  // ============================================================
  // Fetch today's tasks & Auto-generate via API
  // ============================================================
  const fetchTasks = useCallback(async (empId: string) => {
    try {
      const res = await fetch(`/api/support/tasks?employeeId=${empId}`);
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
  // Group tasks by category
  // ============================================================
  const urgentTasks = tasks.filter(t => t.task_type === 'AD-HOC');
  const normalTasks = tasks.filter(t => t.task_type !== 'AD-HOC');

  const groupedTasks: Record<string, { categoryName: string; categoryOrder: number; tasks: TaskItem[] }> = {};
  
  normalTasks.forEach(t => {
    const catId = t.category_id || 'OTHER';
    if (!groupedTasks[catId]) {
      groupedTasks[catId] = {
        categoryName: t.categoryName || 'Các công việc khác',
        categoryOrder: t.categoryOrder || 999,
        tasks: []
      };
    }
    groupedTasks[catId].tasks.push(t);
  });

  const sortedCategories = Object.values(groupedTasks).sort((a, b) => a.categoryOrder - b.categoryOrder);

  const totalTasks = tasks.length;
  const doneCount = tasks.filter(t => t.status === 'COMPLETED').length;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  return {
    urgentTasks,
    sortedCategories,
    doneCount,
    totalTasks,
    pct,
    loading,
    notifications,
    dismissNotification,
    uploadPhoto,
    uploading,
    submitTask,
  };
};
