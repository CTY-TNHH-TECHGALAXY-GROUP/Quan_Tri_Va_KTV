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

  return {
    stats,
    isLoading,
    error,
    isExpanded,
    toggleExpand,
  };
};
