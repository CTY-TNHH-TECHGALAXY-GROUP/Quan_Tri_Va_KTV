'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { createClient } from '@/lib/supabase';
import { SHIFT_TYPES, hasReachedShiftEnd } from '@/lib/shift.constants';
import { vnNow } from '@/lib/vn-time';
import { format } from 'date-fns';

export interface ShiftExtensionState {
  used: boolean;
  currentEndTime: string | null;
  usedAt: string | null;
  canExtend: boolean;
  deadlineReached: boolean;
  isSubmitting: boolean;
  extend: (minutes: number) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useShiftExtension(employeeId: string | undefined | null): ShiftExtensionState {
  const [used, setUsed] = useState(false);
  const [currentEndTime, setCurrentEndTime] = useState<string | null>(null);
  const [usedAt, setUsedAt] = useState<string | null>(null);
  const [canExtend, setCanExtend] = useState(false);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const [cutoffHours, setCutoffHours] = useState(7);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSubmittingRef = useRef(false);

  const fetchExtensionData = useCallback(async () => {
    if (!employeeId) return;

    try {
      const [statusRes, shiftRes, configRes] = await Promise.all([
        apiClient.get<any>(API.KTV.ATTENDANCE_STATUS(employeeId)).catch(() => ({ success: false })),
        apiClient.get<any>(`${API.KTV.SHIFT}?employeeId=${encodeURIComponent(employeeId)}`).catch(() => ({ success: false })),
        apiClient.get<any>(API.SYSTEM.CONFIG).catch(() => ({ success: false })),
      ]);

      const rawFlag = configRes?.data?.show_overtime_on_dashboard;
      // Mặc định bật tính năng trừ khi cấu hình explicitly tắt (false)
      const isFeatureEnabled = rawFlag === undefined || rawFlag === null ? true : (rawFlag === true || rawFlag === 'true');

      const shiftExt = statusRes?.shiftExtension;
      const checkStatus = statusRes?.checkStatus;
      const workType = statusRes?.workType;
      const todayReg = statusRes?.todayRegistration;
      const resolvedCutoffHours = Number(statusRes?.cutoffHours);
      const effectiveCutoffHours = Number.isFinite(resolvedCutoffHours) ? resolvedCutoffHours : 7;

      const isUsed = !!shiftExt?.used;
      const overtimeEndTime = shiftExt?.currentEndTime ?? null;
      const overtimeUsedAt = shiftExt?.usedAt ?? null;

      // Base end time
      let baseEndTime: string | null = null;
      if (workType === 'TYPE_D') {
        baseEndTime = todayReg?.expected_end_time ? String(todayReg.expected_end_time).slice(0, 5) : null;
      } else if (workType === 'TYPE_A') {
        const shifts = shiftRes?.data;
        const activeShift = Array.isArray(shifts) ? (shifts.find((s: any) => s.status === 'ACTIVE') || shifts[0]) : null;
        const shiftTypeKey = activeShift?.shiftType as keyof typeof SHIFT_TYPES;
        if (shiftTypeKey && SHIFT_TYPES[shiftTypeKey]) {
          baseEndTime = SHIFT_TYPES[shiftTypeKey].end;
        }
      }

      // Giờ hiển thị theo thứ tự: OVERTIME server → Type D expected_end_time → Type A shift end
      const displayEndTime = isUsed && overtimeEndTime ? overtimeEndTime : baseEndTime;

      // canExtend: feature flag bật, status CONFIRMED (hoặc CHECKED_IN/LATE_CHECKIN), chưa dùng lượt, đúng Type A/D và có giờ gốc
      const isConfirmedCheckIn = checkStatus === 'CONFIRMED' || checkStatus === 'CHECKED_IN' || checkStatus === 'LATE_CHECKIN';
      const isSupportedType = workType === 'TYPE_A' || workType === 'TYPE_D';
      const eligible = isFeatureEnabled && !isUsed && isConfirmedCheckIn && isSupportedType && !!baseEndTime;
      const reachedDeadline = !!baseEndTime && hasReachedShiftEnd(baseEndTime, format(vnNow(), 'HH:mm'), effectiveCutoffHours);

      setUsed(isUsed);
      setCurrentEndTime(displayEndTime);
      setUsedAt(overtimeUsedAt);
      setCanExtend(eligible);
      setDeadlineReached(!isUsed && reachedDeadline);
      setCutoffHours(effectiveCutoffHours);
    } catch (err) {
      console.error('❌ [useShiftExtension] Failed to fetch data:', err);
    }
  }, [employeeId]);

  useEffect(() => {
    if (used || !currentEndTime) {
      setDeadlineReached(false);
      return;
    }

    const refreshDeadline = () => {
      setDeadlineReached(hasReachedShiftEnd(currentEndTime, format(vnNow(), 'HH:mm'), cutoffHours));
    };

    refreshDeadline();
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      refreshDeadline();
      interval = window.setInterval(refreshDeadline, 60_000);
    }, 60_000 - (Date.now() % 60_000));

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [used, currentEndTime, cutoffHours]);

  const extend = useCallback(async (minutes: number): Promise<boolean> => {
    if (!employeeId) return false;
    if (!Number.isInteger(minutes) || minutes < 60) {
      throw new Error('Thời gian gia hạn tối thiểu là 60 phút (số nguyên)');
    }
    if (deadlineReached) {
      throw new Error('Đã quá giờ gia hạn');
    }

    if (isSubmittingRef.current) return false;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await apiClient.post(API.KTV.ATTENDANCE, {
        employeeId,
        checkType: 'OVERTIME',
        extensionMinutes: minutes,
      });
      await fetchExtensionData();
      return true;
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('409') || err?.message?.includes('đã gia hạn')) {
        await fetchExtensionData();
      }
      throw err;
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [employeeId, fetchExtensionData, deadlineReached]);

  // Initial fetch and Realtime subscription
  useEffect(() => {
    if (!employeeId) return;

    fetchExtensionData();

    const supabase = createClient();
    const channel = supabase
      .channel(`shift-extension-${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'KTVAttendance',
          filter: `employeeId=eq.${employeeId}`,
        },
        () => {
          fetchExtensionData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employeeId, fetchExtensionData]);

  return {
    used,
    currentEndTime,
    usedAt,
    canExtend: canExtend && !deadlineReached,
    deadlineReached,
    isSubmitting,
    extend,
    refresh: fetchExtensionData,
  };
}
