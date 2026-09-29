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
  totalWorkingHours: number;
  avgRating: number;
  ratingCount?: number;
  rating4Count?: number;
  rating3Count?: number;
  rating2Count?: number;
  rating1Count?: number;
  excellentCount: number;
  goodCount?: number;
  averageCount?: number;
  badCount: number;
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
      case 'totalWorkingHours': return b.totalWorkingHours - a.totalWorkingHours;
      case 'rating4Count':
      case 'excellentCount':
        return (b.rating4Count ?? b.excellentCount ?? 0) - (a.rating4Count ?? a.excellentCount ?? 0);
      case 'rating3Count':
      case 'goodCount':
        return (b.rating3Count ?? b.goodCount ?? 0) - (a.rating3Count ?? a.goodCount ?? 0);
      case 'rating2Count':
      case 'averageCount':
        return (b.rating2Count ?? b.averageCount ?? 0) - (a.rating2Count ?? a.averageCount ?? 0);
      case 'rating1Count':
      case 'badCount':
        return (b.rating1Count ?? b.badCount ?? 0) - (a.rating1Count ?? a.badCount ?? 0);
      case 'avgRating':
        return (b.avgRating || 0) - (a.avgRating || 0);
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
