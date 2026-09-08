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
  actualDuration?: number | null;
  bonusPoints: number;
  bonusValue?: number;   // bonusPoints quy ra VNĐ
  grossIncome?: number;  // tiền tua + bonus (chưa trừ thuế)
  taxRate?: number;      // 0 hoặc 0.1
  taxAmount?: number;    // thuế TNCN bị trừ trên đơn
  netIncome?: number;    // thực nhận sau thuế
  isProvisional?: boolean;         // true = khách chưa đánh giá, số còn có thể giảm
  isFeedbackDone?: boolean;
  isTypeD?: boolean;
  commissionBeforeDeduction?: number; // tiền tua trước khi trừ theo sao
  ratingDeductionRate?: number;       // 0 / 0.25 / 0.5 / 0.75
  ratingDeductionAmount?: number;     // số tiền bị trừ do đánh giá
  handover_status?: string;
  /** Đã thực sự nộp ảnh bàn giao chưa — 'PENDING' không nói lên điều đó. */
  handover_submitted?: boolean;
  handover_comment?: string | null;
  /** Ô góp ý khách tích khi đánh giá: [{id, text}] — có từ migration 20260907000000. */
  violations?: { id: string; text: string }[] | null;
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
  const [selectedDates, setSelectedDates] = useState<string[]>([today]);

  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState({ totalCommission: 0, totalGross: 0, totalOrders: 0, disciplinePoints: 100, totalNet: 0 });

  const fetchHistory = useCallback(async (dates: string[]) => {
    if (!user?.id || dates.length === 0) return;
    setIsLoading(true);
    try {
      const datesParam = dates.join(',');
      const result = await apiClient.get<any>(`${API.KTV.HISTORY(user.id, dates[0], dates[dates.length - 1])}&dates=${datesParam}`);
      
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
        tip: 0, commission: 0, duration: 0, bonusPoints: 0, serviceName: '', rating: null,
        bonusValue: 0, grossIncome: 0, taxRate: 0, taxAmount: 0, netIncome: 0, isProvisional: false, isTypeD: false,
        commissionBeforeDeduction: 0, ratingDeductionRate: 0, ratingDeductionAmount: 0
      }));

      const combined = [...bkList, ...dcList].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setHistory(combined);
      // Chỉ cộng tiền cho đơn đã được khách FB (isFeedbackDone = true)
      const fbDone = bkList.filter((r: any) => r.isFeedbackDone);
      const totalCommission = fbDone.reduce((s: number, r: any) => s + (r.commission || 0), 0);
      const totalGross      = fbDone.reduce((s: number, r: any) => s + (r.grossIncome || (r.commission || 0) + ((r.bonusValue ?? r.bonusPoints) || 0)), 0);
      
      let totalNet          = fbDone.reduce((s: number, r: any) => s + (r.netIncome || 0), 0);
      if (totalNet === 0) totalNet = totalGross;

      const uniqueBookings  = new Set(bkList.map((b: any) => {
        const parts = (b.billCode || '').split('-');
        return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : b.billCode;
      }));
      setSummary({ totalCommission, totalGross, totalOrders: uniqueBookings.size, disciplinePoints, totalNet });
    } catch (err: any) {
      console.error('[KTVHistory]', err.message || err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Fetch history when selectedDates changes or user is ready
  useEffect(() => {
    if (!user?.id) return;
    fetchHistory(selectedDates);
  }, [selectedDates, user?.id, fetchHistory]);

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
    selectedDates, setSelectedDates,
    summary,
    getStatusLabel,
    refetch: () => fetchHistory(selectedDates),
  };
};
