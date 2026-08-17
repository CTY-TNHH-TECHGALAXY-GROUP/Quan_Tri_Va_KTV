'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { format, subDays } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { getVnDateStr } from '@/lib/time.logic';

export interface HistoryRecord {
  id: string;
  billCode: string;
  createdAt: string;
  status: string;
  rating: number | null;
  tip: number;
  commission: number;
  serviceName: string;
  duration: number;
  bonusPoints: number;
  handover_status?: string;
  handover_comment?: string | null;
  ktv_comment?: string | null;
  guestCount?: number;
  coWorkers?: string[];
  // Các field cho bảng KTVDisciplineLedger
  type?: 'BOOKING' | 'DISCIPLINE';
  rule_code?: string;
  points_deducted?: number;
  reason?: string;
  images?: any;
  booking_id?: string;
}

export type DatePreset = 'today' | 'yesterday' | '7days' | 'custom';

export const useKTVHistory = () => {
  const { hasPermission, user } = useAuth();

  const today = getVnDateStr();
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo]   = useState(today);

  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState({ totalCommission: 0, totalTip: 0, totalOrders: 0, totalBonus: 0, disciplinePoints: 100 });

  const fetchHistory = useCallback(async (from: string, to: string) => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const result = await apiClient.get<any>(API.KTV.HISTORY(user.id, from, to));
      
      const resData = result.data || {};
      const bookings = Array.isArray(resData) ? resData : (resData.bookings || []);
      const disciplines = resData.disciplines || [];
      const disciplinePoints = resData.disciplinePoints ?? 100;

      // Chuẩn hoá bookings
      const bkList = bookings.map((b: any) => ({ ...b, type: 'BOOKING' as const }));
      
      // Chuẩn hoá disciplines
      const dcList = disciplines.map((d: any) => ({
        id: d.id,
        type: 'DISCIPLINE' as const,
        createdAt: d.created_at,
        status: d.status || 'APPROVED',
        rule_code: d.rule_code,
        points_deducted: d.points_deducted,
        reason: d.reason,
        images: d.images,
        booking_id: d.booking_id,
        // Điền rác cho đúng interface
        billCode: d.booking_id || 'PHẠT LỖI',
        tip: 0, commission: 0, duration: 0, bonusPoints: 0, serviceName: '', rating: null
      }));

      const combined = [...bkList, ...dcList].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setHistory(combined);
      const totalCommission = bkList.reduce((s: number, r: any) => s + (r.commission || 0), 0);
      const totalTip        = bkList.reduce((s: number, r: any) => s + (r.tip || 0), 0);
      const totalBonus      = bkList.reduce((s: number, r: any) => s + (r.bonusPoints || 0), 0);
      const uniqueBookings  = new Set(bkList.map((b: any) => {
        const parts = (b.billCode || '').split('-');
        return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : b.billCode;
      }));
      setSummary({ totalCommission, totalTip, totalOrders: uniqueBookings.size, totalBonus, disciplinePoints });
    } catch (err: any) {
      console.error('[KTVHistory]', err.message || err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Apply preset — re-run when user.id becomes available (after F5)
  useEffect(() => {
    if (!user?.id) return; // wait until auth is ready
    const t = getVnDateStr();
    if (datePreset === 'today') {
      setDateFrom(t); setDateTo(t);
      fetchHistory(t, t);
    } else if (datePreset === 'yesterday') {
      const y = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      setDateFrom(y); setDateTo(y);
      fetchHistory(y, y);
    } else if (datePreset === '7days') {
      const w = format(subDays(new Date(), 6), 'yyyy-MM-dd');
      setDateFrom(w); setDateTo(t);
      fetchHistory(w, t);
    }
    // 'custom' → user picks manually
  }, [datePreset, user?.id]); // eslint-disable-line

  const applyCustomDate = () => fetchHistory(dateFrom, dateTo);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS': return { label: 'Đang làm',       color: 'text-indigo-600 bg-indigo-50' };
      case 'FEEDBACK':    return { label: 'Chờ đánh giá',   color: 'text-blue-600 bg-blue-50' };
      case 'DONE':        return { label: 'Hoàn tất',       color: 'text-emerald-600 bg-emerald-50' };
      case 'COMPLETED':   return { label: 'Hoàn tất',       color: 'text-emerald-600 bg-emerald-50' };
      case 'CANCELLED':   return { label: 'Đã huỷ',         color: 'text-red-500 bg-red-50' };
      default:            return { label: status,            color: 'text-gray-500 bg-gray-50' };
    }
  };

  return {
    user, hasPermission,
    history, isLoading,
    datePreset, setDatePreset,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    applyCustomDate,
    summary,
    getStatusLabel,
    refetch: () => fetchHistory(dateFrom, dateTo),
  };
};
