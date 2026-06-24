'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

// 🔧 CONFIGURATION
const GPS_TIMEOUT_MS = 10000;
const GPS_HIGH_ACCURACY = true;
// VN timezone offset
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Shift start and end times (must match API SHIFT_TYPES config)
const SHIFT_START_TIMES: Record<string, string> = {
    SHIFT_1: '09:00',
    SHIFT_2: '11:00',
    SHIFT_3: '17:00',
    FREE: '00:00',
    REQUEST: '00:00',
    SUPPORT: '00:00',
};
const SHIFT_END_TIMES: Record<string, string> = {
    SHIFT_1: '17:00',
    SHIFT_2: '19:00',
    SHIFT_3: '00:00', // treated as 24:00 of the same day
    FREE: '00:00',
    REQUEST: '00:00',
    SUPPORT: '00:00',
};

// --- TYPES ---
export type CheckStatus = 'IDLE' | 'LOADING_GPS' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CHECKED_OUT';

export interface AttendanceRecord {
    id: string;
    checkType: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    locationText: string | null;
    checkedAt: string;
    estimatedEndTime?: string | null;
}

/**
 * Custom hook for KTV Attendance page logic.
 * Handles GPS geolocation, check-in/check-out, and realtime status updates.
 */
export const useKTVAttendance = () => {
    const { hasPermission, user } = useAuth();
    const [checkStatus, setCheckStatus] = useState<CheckStatus>('IDLE');
    const [currentRecord, setCurrentRecord] = useState<AttendanceRecord | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);

    // Shift timing state
    const [activeShiftType, setActiveShiftType] = useState<string | null>(null);
    const [isLoadingShift, setIsLoadingShift] = useState(false);
    const [isLate, setIsLate] = useState(false);
    const [isOffToday, setIsOffToday] = useState(false);
    const [allowEarlyCheckout, setAllowEarlyCheckout] = useState(true);
    const [dayCutoffHours, setDayCutoffHours] = useState(6);
    const [shiftFetchError, setShiftFetchError] = useState(false);
    const [shiftRetryCount, setShiftRetryCount] = useState(0);
    const [minPhotoBrightness, setMinPhotoBrightness] = useState(40);

    useEffect(() => { setMounted(true); }, []);

    // --- Fetch current attendance status on mount ---
    useEffect(() => {
        if (!user?.id) {
            setInitialLoading(false);
            return;
        }

        const fetchStatus = async () => {
            try {
                const [res, resSettings] = await Promise.all([
                    fetch(`/api/ktv/attendance/status?employeeId=${user.id}`),
                    fetch('/api/ktv/settings')
                ]);
                
                if (resSettings.ok) {
                    const settingsData = await resSettings.json();
                    if (settingsData.success) {
                        if (settingsData.data?.allow_early_checkout !== undefined) {
                            setAllowEarlyCheckout(settingsData.data.allow_early_checkout);
                        }
                        if (settingsData.data?.spa_day_cutoff_hours !== undefined) {
                            setDayCutoffHours(Number(settingsData.data.spa_day_cutoff_hours));
                        }
                        if (settingsData.data?.min_photo_brightness !== undefined) {
                            setMinPhotoBrightness(Number(settingsData.data.min_photo_brightness));
                        }
                    }
                }

                if (!res.ok) {
                    const text = await res.text();
                    console.error(`❌ [Attendance] Status API returned ${res.status}:`, text);
                    return;
                }

                const result = await res.json();

                if (result.success && result.checkStatus) {
                    setCheckStatus(result.checkStatus as CheckStatus);
                    if (result.record) {
                        setCurrentRecord(result.record);
                    }
                }
            } catch (err) {
                console.error('❌ [Attendance] Failed to fetch status:', err);
            } finally {
                setInitialLoading(false);
            }
        };

        fetchStatus();
    }, [user?.id]);

    // Fetch active shift when IDLE (for checkIsLate) or CONFIRMED (to validate checkout time)
    useEffect(() => {
        if (!['IDLE', 'CONFIRMED'].includes(checkStatus) || !user?.id) return;

        if (user.roleId === 'support') {
            setIsLoadingShift(false);
            setIsOffToday(false);
            setShiftFetchError(false);
            setActiveShiftType('SUPPORT');
            return;
        }

        const fetchShift = async () => {
            setIsLoadingShift(true);
            try {
                const res = await fetch(`/api/ktv/shift?employeeId=${user.id}`);
                const result = await res.json();
                // Check if they are OFF today (from the server API to bypass RLS)
                const isOff = result.success && result.data?.isOffToday ? true : false;
                setIsOffToday(isOff);

                if (result.success && result.data?.currentShift && !isOff) {
                    setActiveShiftType(result.data.currentShift.shiftType);
                    setShiftFetchError(false);
                } else {
                    setActiveShiftType(null);
                    // Flag lỗi nếu KTV không OFF nhưng không tìm thấy ca
                    setShiftFetchError(!isOff);
                }

            } catch {
                setActiveShiftType(null);
                setIsOffToday(false);
                setShiftFetchError(true);
            } finally {
                setIsLoadingShift(false);
            }
        };

        fetchShift();
    }, [checkStatus, user?.id, shiftRetryCount]);

    // --- Realtime subscription ---
    useEffect(() => {
        if (!user?.id || !currentRecord?.id) return;

        const channel = supabase
            .channel(`attendance_${currentRecord.id}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'KTVAttendance',
                filter: `id=eq.${currentRecord.id}`,
            }, (payload) => {
                const updated = payload.new as AttendanceRecord;
                setCurrentRecord(updated);

                if (updated.status === 'CONFIRMED') {
                    setCheckStatus(updated.checkType === 'CHECK_OUT' ? 'CHECKED_OUT' : 'CONFIRMED');
                } else if (updated.status === 'REJECTED') {
                    setCheckStatus('REJECTED');
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.id, currentRecord?.id]);

    // --- GPS Removed ---
    // GPS is completely disabled in favor of IP Whitelisting

    // --- Handlers ---
    const checkIsLate = useCallback(() => {
        if (user?.roleId === 'support') {
            setIsLate(false);
            return false;
        }

        if (!activeShiftType) {
            setIsLate(false);
            return false;
        }

        // Bỏ qua check đi muộn cho các ca linh hoạt
        if (activeShiftType === 'FREE' || activeShiftType === 'REQUEST' || activeShiftType === 'SUPPORT') {
            setIsLate(false);
            return false;
        }

        const startTimeStr = SHIFT_START_TIMES[activeShiftType];
        if (!startTimeStr) {
            setIsLate(false);
            return false;
        }

        const vnNow = new Date(Date.now() + VN_OFFSET_MS);
        const [startHour, startMin] = startTimeStr.split(':').map(Number);
        
        // Business Date logic
        const businessNow = new Date(vnNow.getTime() - dayCutoffHours * 60 * 60 * 1000);
        const businessDateStr = businessNow.toISOString().slice(0, 10);
        
        let startMs: number;
        if (startHour < dayCutoffHours) {
            // Ca bắt đầu vào rạng sáng hôm sau
            const nextDay = new Date(businessNow.getTime() + 24 * 60 * 60 * 1000);
            startMs = new Date(`${nextDay.toISOString().slice(0, 10)}T${startTimeStr}:00+07:00`).getTime();
        } else {
            startMs = new Date(`${businessDateStr}T${startTimeStr}:00+07:00`).getTime();
        }
        
        const nowMs = Date.now();
        const late = nowMs > startMs; // nếu giờ hiện tại lớn hơn giờ start ca
        
        setIsLate(late);
        return late;
    }, [activeShiftType, dayCutoffHours]);

    const retryFetchShift = useCallback(() => {
        setShiftFetchError(false);
        setShiftRetryCount(prev => prev + 1);
    }, []);

    const handleAttendance = useCallback(async (
        checkType: 'CHECK_IN' | 'CHECK_OUT' | 'LATE_CHECKIN' | 'SUDDEN_OFF',
        photosBase64?: string[] | null,
        reason?: string | null,
        selectedShiftType?: string | null,
        estimatedEndTime?: string | null,
        wantsToWithdraw?: boolean
    ) => {
        setErrorMsg(null);
        setCheckStatus('LOADING_GPS'); // Will rename this state eventually, keeping string for now to avoid breaking UI

        try {
            const res = await fetch('/api/ktv/attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: user?.id,
                    employeeName: user?.name || 'KTV',
                    checkType,
                    photoBase64: photosBase64 || null,
                    reason: reason || null,
                    latitude: null,
                    longitude: null,
                    locationText: null,
                    selectedShiftType: selectedShiftType || null,
                    estimatedEndTime: estimatedEndTime || null,
                    wantsToWithdraw: wantsToWithdraw || false,
                }),
            });

            if (!res.ok) {
                let errorMsgFromServer = `Lỗi server (${res.status}). Vui lòng thử lại.`;
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    try {
                        const errorData = await res.json();
                        if (errorData.error) errorMsgFromServer = errorData.error;
                    } catch {
                        // ignore parse error
                    }
                } else {
                    const text = await res.text();
                    console.error(`❌ [Attendance POST] Server returned ${res.status}:`, text);
                }

                if (res.status === 413) {
                    errorMsgFromServer = 'Ảnh quá lớn. Vui lòng chụp lại với chất lượng thấp hơn.';
                }
                throw new Error(errorMsgFromServer);
            }

            const result = await res.json();
            if (!result.success) throw new Error(result.error || 'Lỗi gửi yêu cầu');

            setCurrentRecord(result.data);
            if (result.status === 'CONFIRMED') {
                setCheckStatus(checkType === 'CHECK_OUT' ? 'CHECKED_OUT' : 'CONFIRMED');
            } else {
                setCheckStatus('PENDING');
            }
        } catch (err: any) {
            const errorMessage = err.message || 'Lỗi không xác định';
            setErrorMsg(errorMessage);
            // Revert back or stay IDLE if not checked out successfully
            if (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN' || checkType === 'SUDDEN_OFF') {
                setCheckStatus('IDLE');
            } else {
                setCheckStatus('CONFIRMED');
            }
        }
    }, [user?.id]);

    const handleRetry = () => {
        setCheckStatus('IDLE');
        setCurrentRecord(null);
        setErrorMsg(null);
    };

    const clearError = () => {
        setErrorMsg(null);
    };

    // --- Computed ---
    const canAccessPage = hasPermission('ktv_attendance');

    /**
     * Compute whether KTV is allowed to check out right now.
     * - If no shift assigned (activeShiftType = null) → allow (fallback)
     * - SHIFT_3 ends at "00:00" → treated as 24:00 (next midnight) of the shift day
     * - No early checkout allowed: must be >= end time exactly
     */
    const { canCheckOut, checkoutBlockedUntil } = (() => {
        if (!activeShiftType || isLoadingShift) return { canCheckOut: true, checkoutBlockedUntil: null };

        // Ca tự do và Khách yêu cầu thì luôn cho phép về thẳng (không block, không tính đột xuất)
        if (activeShiftType === 'FREE' || activeShiftType === 'REQUEST' || activeShiftType === 'SUPPORT') {
            return { canCheckOut: true, checkoutBlockedUntil: null };
        }

        const endTimeStr = SHIFT_END_TIMES[activeShiftType];
        if (!endTimeStr) return { canCheckOut: true, checkoutBlockedUntil: null };

        const vnNow = new Date(Date.now() + VN_OFFSET_MS);
        const [endHour, endMin] = endTimeStr.split(':').map(Number);

        // Business Date logic
        const businessNow = new Date(vnNow.getTime() - dayCutoffHours * 60 * 60 * 1000);
        const businessDateStr = businessNow.toISOString().slice(0, 10);

        let endMs: number;
        // Nếu giờ tan ca nhỏ hơn giờ cut-off (VD: 00:00, 02:00) -> thuộc rạng sáng ngày tiếp theo của Business Date
        if (endHour < dayCutoffHours || (endHour === dayCutoffHours && endMin === 0)) {
            const nextDay = new Date(businessNow.getTime() + 24 * 60 * 60 * 1000);
            endMs = new Date(`${nextDay.toISOString().slice(0, 10)}T${endTimeStr}:00+07:00`).getTime();
        } else {
            const vnEndStr = `${businessDateStr}T${endTimeStr}:00+07:00`;
            endMs = new Date(vnEndStr).getTime();
        }

        const nowMs = Date.now();
        const allowed = nowMs >= endMs;
        const displayTime = endTimeStr === '00:00' ? '00:00' : endTimeStr;

        return {
            canCheckOut: allowed,
            checkoutBlockedUntil: allowed ? null : displayTime,
        };
    })();

    return {
        checkStatus,
        currentRecord,
        errorMsg,
        mounted,
        initialLoading,
        canAccessPage,
        // Shift checkout control
        canCheckOut,
        checkoutBlockedUntil,
        isLoadingShift,
        activeShiftType,
        shiftFetchError,
        retryFetchShift,
        isLate,
        checkIsLate,
        handleAttendance,
        handleRetry,
        clearError,
        isOffToday,
        allowEarlyCheckout,
        minPhotoBrightness,
        user
    };
};
