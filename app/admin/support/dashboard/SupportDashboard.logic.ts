import { useState, useEffect } from 'react';

export type RoomStat = {
  total: number;
  services: Record<string, number>;
};

export type RoomStatsData = Record<string, RoomStat>;

export const useSupportDashboard = () => {
  const [stats, setStats] = useState<RoomStatsData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState('');

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/support/room-stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      } else {
        setError(data.message);
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleExpand = () => setIsExpanded(!isExpanded);

  const openHotTaskModal = (roomName: string) => {
    setSelectedRoom(roomName);
    setIsCreatingTask(false);
  };

  const closeHotTaskModal = () => {
    setSelectedRoom(null);
  };

  const submitHotTask = async (taskName: string, categoryId: string, assigneeId: string) => {
    if (!selectedRoom) return;
    setIsCreatingTask(true);
    try {
      // Gọi API tạo task (sẽ implement API này sau)
      const res = await fetch('/api/support/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: selectedRoom, // Thực tế cần mapping roomName sang roomId, tạm gửi roomName nếu API support hoặc tìm room_id
          name: taskName,
          task_type: 'AD-HOC',
          category_id: categoryId,
          assignee_id: assigneeId,
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Đã giao việc nóng thành công!');
        closeHotTaskModal();
      } else {
        alert('Lỗi: ' + data.message);
      }
    } catch (err) {
      alert('Lỗi kết nối khi giao việc');
    } finally {
      setIsCreatingTask(false);
    }
  };

  return {
    stats,
    isLoading,
    error,
    isExpanded,
    toggleExpand,
    selectedRoom,
    openHotTaskModal,
    closeHotTaskModal,
    submitHotTask,
    isCreatingTask
  };
};
