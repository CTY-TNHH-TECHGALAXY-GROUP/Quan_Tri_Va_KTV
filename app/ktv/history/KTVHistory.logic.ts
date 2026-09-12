'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { format, subDays } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { getVnDateStr } from '@/lib/time.logic';
import { isFeatureMaintenanceError } from '@/lib/featureMaintenance';

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
  ratingBonusAmount?: number;         // tiền thưởng do khách chấm Xuất sắc
  /** Tên hoặc nhãn khách của dòng này — "HIEU", "Khách 1"… */
  guestLabel?: string | null;
  handover_status?: string;
  /** Đã thực sự nộp ảnh bàn giao chưa — 'PENDING' không nói lên điều đó. */
  handover_submitted?: boolean;
  handover_comment?: string | null;
  /** Ô góp ý khách tích khi đánh giá: [{id, text}] — có từ migration 20260907000000. */
  violations?: { id: string; text: string }[] | null;
  /**
   * Nhãn khi KTV bị tước sạch quyền lợi ở đơn này (bị đổi ra, hoặc huỷ không
   * tính công): "Đã đổi KTV · đã làm 25p · 0đ". `null` với đơn bình thường.
   */
  voidedNote?: string | null;
  /** Lý do tua được chấm cao mà vẫn không có thưởng (đội hỗn hợp chế độ). */
  mixedTeamNote?: string | null;
  /** Loại tước quyền lợi — có giá trị thì đơn này với KTV đã CHỐT 0đ. */
  voidedKind?: 'CHANGED' | 'CANCELLED_NO_CREDIT' | 'OTHER' | null;
  /** Lý do quầy nhập lúc đổi người / huỷ. */
  voidedReason?: string | null;
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
  // Server said the History page is switched off for this KTV. Must be its own
  // state: swallowing the 403 renders "Chưa có đơn hàng nào." and 0đ, which
  // reads as "you had no orders" instead of "this feature is off".
  const [maintenance, setMaintenance] = useState(false);

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
      setMaintenance(false);
    } catch (err: any) {
      if (isFeatureMaintenanceError(err)) {
        setMaintenance(true);
        setHistory([]);
        setSummary({ totalCommission: 0, totalGross: 0, totalOrders: 0, disciplinePoints: 100, totalNet: 0 });
      } else {
        console.error('[KTVHistory]', err.message || err);
      }
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
    history, isLoading, maintenance,
    selectedDates, setSelectedDates,
    summary,
    getStatusLabel,
    refetch: () => fetchHistory(selectedDates),
  };
};

// ─── Sổ giờ tích luỹ (KTV Loại D) ─────────────────────────────────────────────

/** Một dòng trong sổ giờ — cùng hình dạng với sổ giờ ở trang Xếp Hạng Giờ. */
export interface HoursLedgerRow {
  id: string;
  date: string;
  earned: number;
  penalty: number;
  /** Số dư dồn của CẢ THÁNG tính tới dòng này, không phải của khoảng đang chọn. */
  balance: number;
  note: string | null;
  at: string | null;
  /** Có giá trị nghĩa là dòng PHẠT, không phải tua làm. */
  penaltyLabel: string | null;
  orderCode: string | null;
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
const monthOf = (date: string) => date.slice(0, 7);

/**
 * Giờ tích luỹ của chính KTV, lọc theo đúng những ngày đang chọn ở trang Lịch Sử.
 *
 * Server trả sổ giờ theo THÁNG (cùng hàm với trang Xếp Hạng và màn Office của quầy,
 * để ba nơi không ra số khác nhau), còn trang này chọn ngày lẻ — nên lọc ở client
 * theo `selectedDates`. Chỉ gọi lại API khi tập THÁNG đổi: bấm thêm/bớt vài ngày
 * trong cùng một tháng thì dùng luôn dữ liệu đã có.
 */
export const useKtvHoursLedger = (selectedDates: string[]) => {
  const { user } = useAuth();

  const [rows, setRows] = useState<HoursLedgerRow[]>([]);
  const [monthTotals, setMonthTotals] = useState({ earned: 0, penalty: 0, net: 0 });
  const [applicable, setApplicable] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [maintenance, setMaintenance] = useState(false);

  // Tập tháng cần tải — chuỗi ổn định để useEffect không chạy lại vì mảng mới.
  const monthsKey = useMemo(
    () => Array.from(new Set(selectedDates.map(monthOf))).sort().join(','),
    [selectedDates]
  );

  const fetchLedger = useCallback(async () => {
    if (!user?.id || !monthsKey) return;
    setIsLoading(true);
    try {
      const months = monthsKey.split(',');
      const results = await Promise.all(
        months.map(m => apiClient.get<any>(`/api/ktv/hours-ledger?month=${m}`, { timeout: 20000 }))
      );

      setApplicable(results.every(r => r?.applicable !== false));
      setEnabled(results.every(r => r?.enabled !== false));

      // Mỗi tháng server đã trả mới-nhất-trước; ghép nhiều tháng thì xếp lại theo
      // ngày giảm dần (sort của JS ổn định nên thứ tự trong cùng ngày giữ nguyên).
      const merged: HoursLedgerRow[] = results
        .flatMap(r => (r?.rows || []) as HoursLedgerRow[])
        .sort((a, b) => b.date.localeCompare(a.date));
      setRows(merged);

      setMonthTotals({
        earned: results.reduce((s, r) => s + (r?.monthEarned || 0), 0),
        penalty: results.reduce((s, r) => s + (r?.monthPenalty || 0), 0),
        net: results.reduce((s, r) => s + (r?.monthNet || 0), 0),
      });
      setMaintenance(false);
    } catch (err: any) {
      if (isFeatureMaintenanceError(err)) setMaintenance(true);
      else console.error('[KTVHoursLedger]', err?.message || err);
      setRows([]);
      setMonthTotals({ earned: 0, penalty: 0, net: 0 });
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, monthsKey]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  /** Chỉ những dòng rơi đúng vào các ngày đang chọn. */
  const rangeRows = useMemo(() => {
    const picked = new Set(selectedDates);
    return rows.filter(r => picked.has(r.date));
  }, [rows, selectedDates]);

  const rangeTotals = useMemo(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const earned = rangeRows.reduce((s, r) => s + (r.earned || 0), 0);
    const penalty = rangeRows.reduce((s, r) => s + (r.penalty || 0), 0);
    return { earned: r2(earned), penalty: r2(penalty), net: r2(earned - penalty) };
  }, [rangeRows]);

  const months = useMemo(() => (monthsKey ? monthsKey.split(',') : []), [monthsKey]);

  return {
    applicable, enabled, isLoading, maintenance,
    rows: rangeRows, totals: rangeTotals, monthTotals, months,
    refetch: fetchLedger,
  };
};
