import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export interface TurnRecord {
  id: string;
  employee_id: string;
  date: string;
  queue_position: number;
  status: 'ready' | 'working' | 'off';
  turns_completed: number;
  lastTurnTime?: string;
  ktvName?: string;
  ktvCode?: string;
}

export const useTurnsLogic = (selectedDate: string) => {
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTurns = useCallback(async () => {
    setIsLoading(true);
    try {
      const [turnsResult, staffResult] = await Promise.all([
        apiClient.get<any>(`${API.TURNS}?date=${selectedDate}`),
        apiClient.get<any>(API.EMPLOYEES)
      ]);

      const staffMap = new Map<string, any>((staffResult.data || []).map((s: any) => [s.id, s]));
      const mappedTurns = (turnsResult.data || []).map((t: any) => {
        const staff = staffMap.get(t.employee_id);
        return {
          ...t,
          ktvName: staff?.full_name || 'Không rõ',
          ktvCode: staff?.id || '---',
          // Map statuses to UI expected ones if needed
          status: t.status === 'waiting' ? 'ready' : (t.status === 'working' ? 'working' : 'off'),
          lastTurnTime: t.estimated_end_time || ''
        };
      });
      setTurns(mappedTurns);
    } catch (error: any) {
      console.error('Error fetching turns:', error.message || error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchTurns();
  }, [fetchTurns]);

  return {
    turns,
    isLoading,
    refresh: fetchTurns
  };
};
