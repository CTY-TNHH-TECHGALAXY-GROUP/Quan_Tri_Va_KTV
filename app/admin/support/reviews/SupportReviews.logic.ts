import { useState } from 'react';

export const useSupportReviews = () => {
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fake Manager ID
  const managerId = 'fake-manager-id';

  // Fake data (Tasks in PENDING_REVIEW)
  const [pendingTasks, setPendingTasks] = useState([
    {
      id: 'task-1',
      name: 'Dọn dẹp phòng VIP 1',
      roomName: 'VIP 1',
      task_type: 'FIXED',
      assigneeName: 'NV Hậu Cần A',
      status: 'COMPLETED',
      inspection_status: 'PENDING_REVIEW',
      completed_at: '2026-07-16T14:30:00Z',
      photos: [
        { id: 'p1', url: 'https://via.placeholder.com/300x300.png?text=Hinh+Anh+1', is_submitted: true }
      ]
    }
  ]);

  const openReviewModal = (task: any) => setSelectedTask(task);
  const closeReviewModal = () => setSelectedTask(null);

  const submitReview = async (decision: 'PASSED' | 'REWORK_REQUIRED' | 'FAILED', note: string) => {
    if (!selectedTask) return;
    setIsSubmitting(true);
    
    try {
      const res = await fetch(`/api/support/tasks/${selectedTask.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note, managerId })
      });

      const data = await res.json();
      if (data.success) {
        alert(decision === 'PASSED' ? 'Đã duyệt thành công!' : 'Đã yêu cầu làm lại!');
        setPendingTasks(prev => prev.filter(t => t.id !== selectedTask.id));
        closeReviewModal();
      } else {
        alert('Lỗi: ' + data.message);
      }
    } catch (err) {
      alert('Lỗi kết nối khi nghiệm thu');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    pendingTasks,
    selectedTask,
    openReviewModal,
    closeReviewModal,
    submitReview,
    isSubmitting
  };
};
