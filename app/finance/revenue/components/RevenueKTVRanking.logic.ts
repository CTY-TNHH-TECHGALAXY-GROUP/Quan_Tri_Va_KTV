import { useState, useEffect } from 'react';

export interface KTVRankingData {
  id: string;
  name: string;
  revenue: number;
  tuaMoney: number;
  bonus: number;
  workingDays: number;
  leaveDays: number;
  freeTurns: number;
  requestedTurns: number;
  vipTurns: number;
  avgWorkingHours: number;
  avgRating: number;
}

export function useRevenueKTVRanking(dateFromProp: string, dateToProp: string, langFilter?: string) {
  const [data, setData] = useState<KTVRankingData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('revenue');

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams({ dateFrom: dateFromProp, dateTo: dateToProp });
        if (langFilter && langFilter !== 'All') {
          queryParams.append('lang', langFilter);
        }
        const res = await fetch(`/api/finance/reports/ktv-ranking?${queryParams.toString()}`);
        if (!res.ok) throw new Error('Không thể tải dữ liệu xếp hạng KTV');
        
        const json = await res.json();
        setData(json.data || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    if (dateFromProp && dateToProp) {
      fetchData();
    }
  }, [dateFromProp, dateToProp, langFilter]);

  const sortedData = [...data].sort((a, b) => {
    switch (sortBy) {
      case 'revenue': return b.revenue - a.revenue;
      case 'tuaMoney': return b.tuaMoney - a.tuaMoney;
      case 'bonus': return b.bonus - a.bonus;
      case 'workingDays': return b.workingDays - a.workingDays;
      case 'leaveDays': return b.leaveDays - a.leaveDays; // Nghỉ nhiều nhất lên đầu
      case 'avgWorkingHours': return b.avgWorkingHours - a.avgWorkingHours;
      case 'requestedTurns': return b.requestedTurns - a.requestedTurns;
      case 'vipTurns': return b.vipTurns - a.vipTurns;
      default: return 0;
    }
  });

  return {
    data: sortedData,
    isLoading,
    error,
    sortBy,
    setSortBy
  };
}
