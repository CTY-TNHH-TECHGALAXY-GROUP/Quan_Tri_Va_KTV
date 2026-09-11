'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useToast } from '@/components/ui/Toast';

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
    DEV_SHIFT: '09:00',
    FREE: '00:00',
    REQUEST: '00:00',
    SUPPORT: '00:00',
    VIP: '00:00',
};
const SHIFT_END_TIMES: Record<string, string> = {
    SHIFT_1: '17:00',
    SHIFT_2: '19:00',
    SHIFT_3: '00:00', // treated as 24:00 of the same day
    DEV_SHIFT: '21:00',
    FREE: '00:00',
    REQUEST: '00:00',
    SUPPORT: '00:00',
    VIP: '00:00',
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
    const { addToast } = useToast();
    const [checkStatus, setCheckStatus] = useState<CheckStatus>('IDLE');
    const [todayRegistration, setTodayRegistration] = useState<any>(null);
    // Ô rút tiền chỉ hiện ở lần điểm danh ĐẦU TIÊN trong ngày.
    const [canRequestWithdraw, setCanRequestWithdraw] = useState(true);
    // TUA wallet switched off (server truth). Only meaningful for KTVs who
    // hold the wallet permission — see `withdrawShowsMaintenance` below.
    const [withdrawWalletOff, setWithdrawWalletOff] = useState(false);
    const [currentRecord, setCurrentRecord] = useState<AttendanceRecord | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);

    const [isAdjusting, setIsAdjusting] = useState(false);
    const [adjustmentType, setAdjustmentType] = useState<'ABSENT' | 'LATE'>('LATE');
    const [lateExpectedTime, setLateExpectedTime] = useState('');
    const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false);


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
    const [workType, setWorkType] = useState<string>('TYPE_A');
    const [availableUntil, setAvailableUntil] = useState<string | null>(null);
    const [showOvertimeFeature, setShowOvertimeFeature] = useState(false);
    const [incompleteTasksCount, setIncompleteTasksCount] = useState(0);
    // Nợ phòng (bàn giao chưa nộp / phòng đang dọn dở) — chặn ở bước tan ca.
    const [roomDebt, setRoomDebt] = useState<{ handover: number; cleaning: number; total: number; items: any[] }>(
        { handover: 0, cleaning: 0, total: 0, items: [] });
    const [guestArrivalLock, setGuestArrivalLock] = useState<{ active: boolean; lockedBy: string; lockedAt: string; message: string }>({
        active: false,
        lockedBy: '',
        lockedAt: '',
        message: ''
    });

    useEffect(() => { setMounted(true); }, []);

    // --- Fetch current attendance status ---
    const refreshAttendanceStatus = useCallback(async () => {
        if (!user?.id) return;
        try {
                const [statusRes, settingsRes, configRes] = await Promise.all([
                    apiClient.get<any>(API.KTV.ATTENDANCE_STATUS(user.id)).catch((err) => {
                        console.error(`❌ [Attendance] Status API returned error:`, err);
                        return { success: false, checkStatus: 'IDLE', record: null, workType: 'TYPE_A' };
                    }),
                    apiClient.get<any>(API.KTV.SETTINGS).catch(() => ({ success: false, data: {} })),
                    apiClient.get<any>(API.SYSTEM.CONFIG).catch(() => ({ success: false, data: {} })),
                ]);
                
                if (statusRes.success) {
                    if (statusRes.workType) setWorkType(statusRes.workType);
                    if (statusRes.availableUntil) setAvailableUntil(statusRes.availableUntil);
                    if (statusRes.incompleteTasksCount !== undefined) setIncompleteTasksCount(statusRes.incompleteTasksCount);
                    if (statusRes.roomDebt) setRoomDebt(statusRes.roomDebt);
                    if (statusRes.guestArrivalLock) setGuestArrivalLock(statusRes.guestArrivalLock);
                    if (statusRes.todayRegistration) setTodayRegistration(statusRes.todayRegistration);
                    setCanRequestWithdraw(statusRes.canRequestWithdraw !== false);
                    setWithdrawWalletOff(statusRes.withdrawWalletOff === true);
                }
                
                if (settingsRes.success && settingsRes.data) {
                    if (settingsRes.data.allow_early_checkout !== undefined) {
                        setAllowEarlyCheckout(settingsRes.data.allow_early_checkout);
                    }
                    if (settingsRes.data.spa_day_cutoff_hours !== undefined) {
                        setDayCutoffHours(Number(settingsRes.data.spa_day_cutoff_hours));
                    }
                    if (settingsRes.data.min_photo_brightness !== undefined) {
                        setMinPhotoBrightness(Number(settingsRes.data.min_photo_brightness));
                    }
                }

                if (configRes.success && configRes.data) {
                    const raw = configRes.data.show_overtime_on_dashboard;
                    setShowOvertimeFeature(raw === true || raw === 'true');
                }

                if (statusRes.success && statusRes.checkStatus) {
                    // Update checkStatus and currentRecord
                    setCheckStatus(statusRes.checkStatus);
                    setCurrentRecord(statusRes.record || null);
                    
                    // Xóa errorMsg nếu đang có
                    setErrorMsg(null);
                } else {
                    setCheckStatus('IDLE');
                }
            } catch (err) {
                console.error('❌ [Attendance] Failed to fetch status:', err);
            } finally {
                setInitialLoading(false);
            }
    }, [user?.id]);

    useEffect(() => {
        refreshAttendanceStatus();
    }, [refreshAttendanceStatus]);

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

        if (user.roleId === 'dev') {
            setIsLoadingShift(false);
            setIsOffToday(false);
            setShiftFetchError(false);
            setActiveShiftType('DEV_SHIFT');
            return;
        }

        const fetchShift = async () => {
            setIsLoadingShift(true);
            try {
                const result = await apiClient.get<any>(`${API.KTV.SHIFT}?employeeId=${user.id}`);
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

    useEffect(() => {
        const lockChannel = supabase
            .channel('guest_arrival_events')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'GuestArrivalEvents',
            }, () => {
                refreshAttendanceStatus();
            })
            .subscribe();

        return () => { supabase.removeChannel(lockChannel); };
    }, [refreshAttendanceStatus]);

    // --- GPS Removed ---
    // GPS is completely disabled in favor of IP Whitelisting

    // --- Handlers ---
    const checkIsLate = useCallback(() => {
        if (user?.roleId === 'support' || workType === 'TYPE_B' || workType === 'TYPE_D') {
            setIsLate(false);
            return false;
        }

        if (!activeShiftType) {
            setIsLate(false);
            return false;
        }

        // Bỏ qua check đi muộn cho các ca linh hoạt
        if (activeShiftType === 'FREE' || activeShiftType === 'REQUEST' || activeShiftType === 'SUPPORT' || activeShiftType === 'VIP') {
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
    }, [activeShiftType, dayCutoffHours, user?.roleId, workType]);

    const retryFetchShift = useCallback(() => {
        setShiftFetchError(false);
        setShiftRetryCount(prev => prev + 1);
    }, []);

    const handleAttendance = useCallback(async (
        checkType: 'CHECK_IN' | 'CHECK_OUT' | 'LATE_CHECKIN' | 'SUDDEN_OFF' | 'OVERTIME',
        photosBase64?: string[] | null,
        reason?: string | null,
        selectedShiftType?: string | null,
        estimatedEndTime?: string | null,
        wantsToWithdraw?: boolean,
        isLiveCapture?: boolean
    ) => {
        setErrorMsg(null);
        setCheckStatus('LOADING_GPS'); // Will rename this state eventually, keeping string for now to avoid breaking UI

        try {
            const result = await apiClient.post<any>(API.KTV.ATTENDANCE, {
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
                isLiveCapture: isLiveCapture || false,
            });

            if (!result.success) throw new Error(result.error || 'Lỗi gửi yêu cầu');

            setCurrentRecord(result.data);
            // Check-in succeeded but the withdrawal intent was refused because the
            // TUA wallet is off (switched off after the form was opened).
            if (result.withdrawIntentBlocked && result.withdrawIntentMessage) {
                addToast(result.withdrawIntentMessage, 'error');
            }
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
    }, [user?.id, addToast]);

    
    const handleAdjustmentSubmit = async () => {
        if (!user?.id) return;
        setIsSubmittingAdjustment(true);
        setErrorMsg(null);
        try {
            const result = await apiClient.post(API.KTV.ATTENDANCE_ADJUSTMENT, {
                action: adjustmentType === "ABSENT" ? "REPORT_ABSENT" : "REPORT_LATE",
                late_expected_time: adjustmentType === "LATE" ? lateExpectedTime : null,
            });
            addToast("Cập nhật thành công!", "success");
            setIsAdjusting(false);
            refreshAttendanceStatus();
        } catch(err: any) {
            addToast(err.message || "Có lỗi xảy ra", "error");
        } finally {
            setIsSubmittingAdjustment(false);
        }
    };

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
        if (activeShiftType === 'FREE' || activeShiftType === 'REQUEST' || activeShiftType === 'SUPPORT' || activeShiftType === 'VIP') {
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
        todayRegistration,
        canRequestWithdraw,
        // Permission ON + TUA wallet OFF → notice instead of the checkbox.
        // No permission → keep the old behaviour (checkbox rules unchanged).
        withdrawShowsMaintenance: withdrawWalletOff && hasPermission('ktv_wallet'),
        withdrawWalletOff,
        isAdjusting,
        setIsAdjusting,
        adjustmentType,
        setAdjustmentType,
        lateExpectedTime,
        setLateExpectedTime,
        isSubmittingAdjustment,
        handleAdjustmentSubmit,
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
        // KTV Loại D làm theo đăng ký ngày, KHÔNG có ca cố định trong KTVShiftRecords.
        // Không tìm thấy ca là chuyện bình thường với họ — đừng báo "Không tải được ca làm việc",
        // vì màn hình sẽ nuốt mất ô chọn Ca tự do và khoá luôn nút Gửi.
        shiftFetchError: workType === 'TYPE_D' ? false : shiftFetchError,
        retryFetchShift,
        isLate,
        checkIsLate,
        handleAttendance,
        handleRetry,
        clearError,
        // ⚠️ isOffToday từ API /ktv/shift chỉ tra bảng KTVLeaveRequests — bảng mà KTV Loại D
        // KHÔNG dùng. Ngày OFF của Loại D nằm ở KTVTypeDDailyRegistration (status OFF_REGISTERED),
        // trả về qua todayRegistration. Gộp cả hai nguồn để màn điểm danh nhận đúng ngày OFF.
        isOffToday: isOffToday || (workType === 'TYPE_D' && todayRegistration?.status === 'OFF_REGISTERED'),
        allowEarlyCheckout,
        minPhotoBrightness,
        showOvertimeFeature,
        user,
        workType,
        availableUntil,
        refreshAttendanceStatus,
        incompleteTasksCount,
        roomDebt,
        guestArrivalLock,
    };
};
