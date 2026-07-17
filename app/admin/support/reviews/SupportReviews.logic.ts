import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================================
// Types
// ============================================================
interface ReviewTask {
  id: string;
  name: string;
  roomName: string | null;
  assigneeName: string;
  photoCount: number;
  completed_at: string;
  photos: { photo_url: string; taken_at: string }[];
}

export const useSupportReviews = () => {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ReviewTask | null>(null);

  const openReviewModal = (task: ReviewTask) => setSelectedTask(task);
  const closeReviewModal = () => setSelectedTask(null);

  // Fetch tasks that are COMPLETED + PENDING_REVIEW
  const fetchPendingReview = useCallback(async () => {
    const { data, error } = await supabase
      .from('Tasks')
      .select('id, name, assignee_id, status, inspection_status, updated_at, Users!Tasks_assignee_id_fkey(fullName)')
      .eq('status', 'COMPLETED')
      .in('inspection_status', ['PENDING_REVIEW', 'NOT_REVIEWED'])
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending reviews:', error.message, error.code);
      setLoading(false);
      return;
    }

    // Get photo counts
    const taskIds = (data || []).map(t => t.id);
    let photoCounts: Record<string, number> = {};
    let taskPhotosMap: Record<string, any[]> = {};
    if (taskIds.length > 0) {
      const { data: photos } = await supabase
        .from('TaskPhotos')
        .select('task_id, photo_url, taken_at')
        .in('task_id', taskIds)
        .eq('is_submitted', true);
      (photos || []).forEach(p => {
        photoCounts[p.task_id] = (photoCounts[p.task_id] || 0) + 1;
        if (!taskPhotosMap[p.task_id]) taskPhotosMap[p.task_id] = [];
        taskPhotosMap[p.task_id].push(p);
      });
    }

    const mapped: ReviewTask[] = (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      roomName: null,
      assigneeName: t.Users?.fullName || 'Chưa rõ',
      photoCount: photoCounts[t.id] || 0,
      completed_at: t.updated_at,
      photos: taskPhotosMap[t.id] || []
    }));

    setTasks(mapped);
    setLoading(false);
  }, []);

  // Review a task
  const reviewTask = async (taskId: string, decision: 'PASSED' | 'REWORK_REQUIRED') => {
    setSubmitting(true);
    try {
      const task = tasks.find(t => t.id === taskId);

      const updatePayload: any = {
        inspection_status: decision,
      };
      if (decision === 'REWORK_REQUIRED') {
        updatePayload.status = 'IN_PROGRESS';
      }

      const { error } = await supabase
        .from('Tasks')
        .update(updatePayload)
        .eq('id', taskId);

      if (error) {
        console.error('Error reviewing task:', error.message, error.code);
        return;
      }

      // Send notification for rework
      if (decision === 'REWORK_REQUIRED' && task) {
        const taskData = await supabase.from('Tasks').select('assignee_id').eq('id', taskId).single();
        if (taskData.data?.assignee_id) {
          await supabase.from('TaskNotifications').insert({
            task_id: taskId,
            employee_id: taskData.data.assignee_id,
            type: 'REWORK',
            message: `Quản lý yêu cầu làm lại: ${task.name}`,
          });
        }
      }

      // Remove from list
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    fetchPendingReview();
  }, [fetchPendingReview]);

  return {
    tasks,
    loading,
    submitting,
    reviewTask,
    selectedTask,
    openReviewModal,
    closeReviewModal,
  };
};
