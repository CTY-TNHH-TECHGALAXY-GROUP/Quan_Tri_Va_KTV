'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useToast } from '@/components/ui/Toast';

// 🔧 UI CONFIGURATION
const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

// --- TYPES ---
export interface LeaveRequest {
    id: string;
    employeeId: string;
    employeeName: string;
    date: string;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    createdAt: string;
}
export interface ShiftRecord {
    id: string;
    employeeId: string;
    employeeName: string;
    shiftType: string;
    effectiveFrom: string;
    previousShift: string | null;
    reason: string | null;
    status: 'ACTIVE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REPLACED';
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
}

export interface ShiftTypes {
    [key: string]: { label: string; start: string; end: string };
}

export type ScheduleTab = 'off' | 'shift';

export const useKTVSchedule = () => {
    const { hasPermission, user, logout } = useAuth();
    const { addToast } = useToast();

    // Common
    const [mounted, setMounted] = useState(false);
    const canAccessPage = hasPermission('ktv_schedule');

    // Tab state
    const [activeTab, setActiveTab] = useState<ScheduleTab>('off');

    // ── OFF state ──
    const [selectedDates, setSelectedDates] = useState<string[]>([]);
    const [isSubmittingOff, setIsSubmittingOff] = useState(false);
    const [leaveList, setLeaveList] = useState<LeaveRequest[]>([]);
    const [workRegistrationList, setWorkRegistrationList] = useState<any[]>([]);
    
    // D1: Giờ riêng từng ngày
    const [expectedTimes, setExpectedTimes] = useState<Record<string, string>>({});
    
    // A1: Màn xác nhận đăng ký
    const [pendingSubmit, setPendingSubmit] = useState<{ type: 'WORKING' | 'OFF', dates: string[] } | null>(null);

    // E1: Màn sửa lịch
    const [editingReg, setEditingReg] = useState<{ date: string, expected_time: string, status: string, step?: 'EDIT' | 'CONFIRM_CANCEL' } | null>(null);

    const [isLoadingLeaves, setIsLoadingLeaves] = useState(false);

    // Phiên của tab này không phải người mà server đang thấy (xem chi tiết ở
    // kiểm tra phía dưới). Chặn hẳn màn hình thay vì để lịch trống trơn.
    const [identityMismatch, setIdentityMismatch] = useState<string | null>(null);
    const [offError, setOffError] = useState<string | null>(null);
    const [offSuccess, setOffSuccess] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        type: 'SUDDEN_OFF_WARNING' | 'EXTENSION_CONFIRM';
        message: string;
        remaining?: number;
    } | null>(null);

    // ── SHIFT state ──
    const [currentShift, setCurrentShift] = useState<{ type: string; start: string; end: string } | null>(null);
    const [tomorrowShift, setTomorrowShift] = useState<{ type: string; start: string; end: string } | null>(null);
    const [pendingRequest, setPendingRequest] = useState<any | null>(null);
    const [shiftHistory, setShiftHistory] = useState<any[]>([]);
    const [shiftTypes, setShiftTypes] = useState<ShiftTypes>({});
    const [isLoadingShift, setIsLoadingShift] = useState(false);

    const [newShiftType, setNewShiftType] = useState<string>('');
    const [shiftReason, setShiftReason] = useState('');
    const [isSubmittingShift, setIsSubmittingShift] = useState(false);
    const [shiftError, setShiftError] = useState<string | null>(null);
    const [shiftSuccess, setShiftSuccess] = useState(false);

    // Calendar state
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const d = new Date();
        return { year: d.getFullYear(), month: d.getMonth() };
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    const fetchLeaveList = useCallback(async () => {
        if (!user?.id) return;
        setIsLoadingLeaves(true);
        try {
            const y = calendarMonth.year;
            const m = calendarMonth.month;
            const startStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
            // Ngày cuối tháng thật, không hard-code 31 (tránh 30/2, 31/4...)
            const endStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;

            // ⚠️ Cả 2 API đều đọc tham số `from` / `to` — KHÔNG phải start_date/end_date.
            // Dùng sai tên thì server bỏ qua bộ lọc và trả về khoảng mặc định.
            // ⚠️ Danh tính của API và của màn hình KHÔNG cùng phạm vi:
            //   • API biết bạn là ai qua cookie JWT của Supabase — dùng chung CẢ TRÌNH DUYỆT,
            //     ai đăng nhập sau thì đè lên trước.
            //   • Màn hình biết bạn là ai qua sessionStorage — riêng TẪNG TAB.
            // Mở hai tài khoản KTV trên cùng một trình duyệt là hai bên lệch nhau: API trả về
            // lịch của NGƯỜI KIA. Trước đây page.tsx lọc lại theo `staff_id === user.code` nên
            // lệch biến thành "lịch trống trơn, không báo lỗi gì". Bỏ bộ lọc đó mà không chặn
            // ở đây thì còn tệ hơn: nhìn và sửa được lịch của đồng nghiệp.
            const khopDanhTinh = (serverStaffId: any) => {
                const mine = String(user.code || user.id || '').trim().toLowerCase();
                const theirs = String(serverStaffId || '').trim().toLowerCase();
                if (!theirs || !mine || theirs === mine) return true;
                setIdentityMismatch(theirs);
                setWorkRegistrationList([]);
                setLeaveList([]);
                return false;
            };

            if (user.work_type === 'TYPE_D') {
                const res = await apiClient.get<any>(`${API.KTV.DAILY_REGISTRATION}?from=${startStr}&to=${endStr}`);
                if (!khopDanhTinh(res?.staff_id)) return;
                setIdentityMismatch(null);
                setWorkRegistrationList(res?.data || []);
            } else {
                // API trả về { success, data } chứ không phải mảng trần.
                const res = await apiClient.get<any>(`${API.KTV.LEAVE}?from=${startStr}&to=${endStr}`);
                if (!khopDanhTinh(res?.staff_id)) return;
                setIdentityMismatch(null);
                setLeaveList(Array.isArray(res?.data) ? res.data : []);
            }
            
        } catch (err: any) {
            console.error('Lỗi khi tải lịch:', err);
            // Trước đây lỗi bị nuốt hoàn toàn → màn hình rỗng mà không rõ lý do.
            setOffError(err?.message || 'Không tải được lịch. Vui lòng thử lại.');
        } finally {
            setIsLoadingLeaves(false);
        }
    }, [calendarMonth, user?.id, user?.code, user?.work_type]);

    const fetchShiftData = useCallback(async () => {
        if (!user?.id) return;
        setIsLoadingShift(true);
        try {
            const data = await apiClient.get<any>(API.KTV.SHIFT);
            setCurrentShift(data.currentShift || null);
            setTomorrowShift(data.tomorrowShift || null);
            setPendingRequest(data.pendingRequest || null);
            setShiftHistory(data.history || []);
            setShiftTypes(data.shiftTypes || {});
        } catch (err) {
            console.error('Lỗi khi tải ca làm việc:', err);
        } finally {
            setIsLoadingShift(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (mounted && canAccessPage) {
            fetchLeaveList();
            if (user?.work_type !== 'TYPE_D') {
                fetchShiftData();
            }
        }
    }, [mounted, canAccessPage, fetchLeaveList, fetchShiftData, user?.work_type]);

    const toggleDate = (date: string) => {
        setSelectedDates(prev => {
            if (prev.includes(date)) {
                return prev.filter(d => d !== date);
            } else {
                return [...prev, date];
            }
        });
    };

    // Calendar navigation
    const goToPrevMonth = useCallback(() => {
        setCalendarMonth(prev => {
            if (prev.month === 0) return { year: prev.year - 1, month: 11 };
            return { ...prev, month: prev.month - 1 };
        });
    }, []);

    const goToNextMonth = useCallback(() => {
        setCalendarMonth(prev => {
            if (prev.month === 11) return { year: prev.year + 1, month: 0 };
            return { ...prev, month: prev.month + 1 };
        });
    }, []);

    const goToToday = useCallback(() => {
        const now = new Date();
        setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() });
    }, []);

    // ── Submit OFF request ──
    const handleSubmitWorkRegistration = () => {
        if (selectedDates.length === 0 || !user?.id) return;
        setPendingSubmit({ type: 'WORKING', dates: selectedDates });
    };

    const handleCancelWorkRegistration = async (dateStr: string) => {
        setIsSubmittingOff(true);
        setOffError(null);
        try {
            const res = await apiClient.post(API.KTV.DAILY_REGISTRATION, {
                // Server chuyển CANCEL thành OFF chứ không xoá bản ghi — xoá thì
                // cron chốt sổ thấy "không đăng ký gì" và khoá tài khoản.
                type: "CANCEL",
                dates: [dateStr],
            });
            fetchLeaveList();
            setEditingReg(null);
            // Server trả về `penalised` nếu bỏ ca sau hạn miễn phạt (12:00 hôm trước).
            const bịPhạt = (res as any)?.penalised?.[0];
            if (bịPhạt) {
                addToast(`Đã chuyển sang OFF. Bạn bị trừ ${bịPhạt.hours} giờ tích lũy do bỏ ca sau 00:00 ngày làm việc.`, "warning");
            } else {
                addToast("Đã chuyển ngày này sang OFF", "success");
            }
        } catch(err: any) {
            setOffError(err.message || "Có lỗi xảy ra khi hủy");
        } finally {
            setIsSubmittingOff(false);
        }
    };

    const handleSaveEditRegistration = async () => {
        if (!editingReg) return;
        try {
            setIsSubmittingOff(true);
            setOffError(null);
            await apiClient.post(API.KTV.DAILY_REGISTRATION, {
                type: "WORKING",
                entries: [
                    { work_date: editingReg.date, expected_time: editingReg.expected_time }
                ]
            });
            fetchLeaveList();
            setEditingReg(null);
            addToast("Cập nhật lịch thành công", "success");
        } catch(err: any) {
            setOffError(err.message || "Có lỗi xảy ra khi sửa");
        } finally {
            setIsSubmittingOff(false);
        }
    };

    const confirmSubmitWorkRegistration = async () => {
        if (!pendingSubmit || pendingSubmit.type !== 'WORKING' || !user?.id) return;
        
        const missingTimes = pendingSubmit.dates.filter(d => !expectedTimes[d]);
        if (missingTimes.length > 0) {
            setOffError("Vui lòng nhập giờ đến tiệm cho tất cả các ngày đã chọn");
            return;
        }

        setIsSubmittingOff(true);
        setOffError(null);
        setOffSuccess(false);
        try {
            const entries = pendingSubmit.dates.map(d => ({
                work_date: d,
                expected_time: expectedTimes[d]
            }));

            await apiClient.post(API.KTV.DAILY_REGISTRATION, {
                type: "WORKING",
                entries
            });
            setOffSuccess(true);
            setSelectedDates([]);
            setExpectedTimes({});
            setPendingSubmit(null);
            fetchLeaveList();
            setTimeout(() => setOffSuccess(false), 3000);
        } catch (err: any) {
            setOffError(err.message || "Có lỗi xảy ra");
        } finally {
            setIsSubmittingOff(false);
        }
    };

    const handleSubmitOff = async (isConfirming?: 'extension' | 'sudden_off') => {
        if (selectedDates.length === 0 || !user?.id) return;
        
        // Modal Flow cho OFF
        if (!isConfirming && !pendingSubmit) {
            setPendingSubmit({ type: 'OFF', dates: selectedDates });
            return;
        }

        // Chạy đoạn code confirm cũ
        setIsSubmittingOff(true);
        setOffError(null);
        setOffSuccess(false);

        try {
            if (user.work_type === 'TYPE_D') {
                await apiClient.post(API.KTV.DAILY_REGISTRATION, {
                    type: "OFF",
                    dates: pendingSubmit?.dates || selectedDates
                });
                setOffSuccess(true);
                setSelectedDates([]);
                setPendingSubmit(null);
                fetchLeaveList();
                setTimeout(() => setOffSuccess(false), 3000);
            } else {
                const payload: any = {
                    employeeId: user.id,
                    employeeName: user.name || user.id,
                    dates: pendingSubmit?.dates || selectedDates,
                    reason: 'Xin nghỉ',
                };
                if (isConfirming === 'extension') payload.confirmExtension = true;
                if (isConfirming === 'sudden_off') payload.confirmSuddenOff = true;

                const result = await apiClient.post<any>(API.KTV.LEAVE, payload);

                if (result.requireConfirmation) {
                    setConfirmDialog({
                        isOpen: true,
                        type: result.type,
                        message: result.message,
                        remaining: result.remaining
                    });
                    return;
                }

                setConfirmDialog(null);
                setOffSuccess(true);
                setSelectedDates([]);
                setPendingSubmit(null);
                fetchLeaveList();
                setTimeout(() => setOffSuccess(false), 3000);
            }
        } catch (err: any) {
            setOffError(err.message || 'Lỗi hệ thống');
        } finally {
            setIsSubmittingOff(false);
        }
    };

    // ── Submit shift change request ──
    const handleSubmitShift = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newShiftType || !user?.id) return;

        // Ràng buộc: sau 19h không cho đổi ca (áp dụng cho ngày hôm sau)
        const nowHour = new Date().getHours();
        if (nowHour >= 19) {
            setShiftError('Sau 19h00 không thể đổi ca. Vui lòng đổi trước 19h.');
            return;
        }

        setIsSubmittingShift(true);
        setShiftError(null);
        setShiftSuccess(false);

        try {
            await apiClient.post<any>(API.KTV.SHIFT, {
                employeeId: user.id,
                employeeName: user.name || user.id,
                shiftType: newShiftType,
            });

            setShiftSuccess(true);
            setNewShiftType('');
            setShiftReason('');
            fetchShiftData();
            setTimeout(() => setShiftSuccess(false), 3000);
        } catch (err: any) {
            setShiftError(err.message || 'Lỗi không xác định');
        } finally {
            setIsSubmittingShift(false);
        }
    };

    return {
        mounted,
        canAccessPage,
        user,
        logout,
        activeTab,
        setActiveTab,

        // OFF
        selectedDates,
        toggleDate,
        isSubmittingOff,
        leaveList,
        workRegistrationList,
        isLoadingLeaves,
        identityMismatch,
        offError,
        offSuccess,
        setOffSuccess,
        setOffError,
        handleSubmitOff,
        confirmDialog,
        setConfirmDialog,
        
        expectedTimes,
        setExpectedTimes,
        pendingSubmit,
        setPendingSubmit,
        editingReg,
        setEditingReg,
        handleSaveEditRegistration,
        handleSubmitWorkRegistration,
        confirmSubmitWorkRegistration,
        handleCancelWorkRegistration,

        // Calendar
        calendarMonth,
        goToPrevMonth,
        goToNextMonth,
        goToToday,
        WEEKDAY_LABELS,

        // Shift
        currentShift,
        tomorrowShift,
        pendingRequest,
        shiftHistory,
        shiftTypes,
        isLoadingShift,
        newShiftType,
        shiftReason,
        isSubmittingShift,
        shiftError,
        shiftSuccess,
        setNewShiftType,
        setShiftReason,
        setShiftError,
        handleSubmitShift,
    };
};
