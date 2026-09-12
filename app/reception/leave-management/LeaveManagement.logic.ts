'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

// --- TYPES ---
export interface StaffOption {
    id: string;
    full_name: string;
}

// 🔧 CONFIGURATION
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// --- TYPES ---
export type AdminTab = 'off' | 'shift';

export interface LeaveRequest {
    id: string;
    employeeId: string;
    employeeName: string;
    date: string;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
    is_extension?: boolean;
    is_sudden_off?: boolean;
}

export interface ShiftRecord {
    id: string;
    employeeId: string;
    employeeName: string;
    shiftType: string;
    effectiveFrom: string;
    previousShift: string | null;
    reason: string | null;
    status: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
    estimatedEndTime?: string | null;
}

/**
 * Get current VN time as a Date object.
 */
const getVnNow = () => new Date(Date.now() + VN_OFFSET_MS);

/**
 * Custom hook for Admin Leave Management page.
 * Supports Calendar Month view.
 */
export const useLeaveManagement = () => {
    const { hasPermission } = useAuth();
    const [mounted, setMounted] = useState(false);
    const [leaveList, setLeaveList] = useState<LeaveRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

    // Admin tab state
    const [adminTab, setAdminTab] = useState<AdminTab>('off');

    // ── Calendar state ──
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() }; // 0-indexed
    });
    
    // Day selected by manager to view details
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    useEffect(() => { setMounted(true); }, []);

    const canAccessPage = hasPermission('leave_management');

    // --- Fetch leave list ---
    const fetchLeaveList = useCallback(async () => {
        setIsLoading(true);
        try {
            const { year, month } = calendarMonth;
            const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month + 1, 0).getDate();
            const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

            const result = await apiClient.get<any>(`${API.KTV.LEAVE}?from=${from}&to=${to}`);

            if (result.data) {
                setLeaveList(result.data || []);
            } else {
                console.error('❌ [LeaveManagement] Fetch error:', result.error);
            }
        } catch (err: any) {
            console.error('❌ [LeaveManagement] Fetch failed:', err.message || err);
        } finally {
            setIsLoading(false);
        }
    }, [calendarMonth]);

    useEffect(() => {
        if (mounted) {
            fetchLeaveList();
        }
    }, [mounted, fetchLeaveList]);

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

    // --- Delete ---
    const handleDelete = async (leaveId: string) => {
        if (!confirm('Bạn chắc chắn muốn xoá yêu cầu này?')) return;

        setActionLoading(prev => ({ ...prev, [leaveId]: 'delete' }));
        try {
            await apiClient.delete<any>(`${API.KTV.LEAVE}?id=${leaveId}`);
            fetchLeaveList();
        } catch (err: any) {
            console.error('❌ [LeaveManagement] Delete error:', err.message || err);
            alert(err.message || 'Lỗi xoá');
        } finally {
            setActionLoading(prev => { const next = { ...prev }; delete next[leaveId]; return next; });
        }
    };

    // --- Admin Register OFF ---
    const [adminRegisterLoading, setAdminRegisterLoading] = useState(false);
    const [adminStaffList, setAdminStaffList] = useState<StaffOption[]>([]);

    const fetchAdminStaffList = useCallback(async () => {
        try {
            const result = await apiClient.get<any>(API.STAFF_LIST);
            if (result.data) setAdminStaffList(result.data || []);
        } catch (err: any) {
            console.error('❌ [LeaveManagement] Fetch staff error:', err.message || err);
        }
    }, []);

    useEffect(() => { if (mounted) fetchAdminStaffList(); }, [mounted, fetchAdminStaffList]);

    const adminRegisterOff = async (employeeId: string, date: string) => {
        setAdminRegisterLoading(true);
        try {
            const staff = adminStaffList.find(s => s.id === employeeId);
            await apiClient.post<any>(API.KTV.LEAVE, {
                employeeId,
                employeeName: staff?.full_name || employeeId,
                dates: [date],
                reason: 'Admin đăng ký giúp',
                registeredByAdmin: true,
            });
            fetchLeaveList();
        } catch (err: any) {
            console.error('❌ [LeaveManagement] Admin register OFF error:', err.message || err);
            alert(err.message || 'Lỗi đăng ký OFF');
        } finally {
            setAdminRegisterLoading(false);
        }
    };

    return {
        mounted,
        canAccessPage,
        isLoading,
        actionLoading,
        leaveList,
        handleDelete,
        adminTab,
        setAdminTab,
        // Calendar
        calendarMonth,
        selectedDate,
        setSelectedDate,
        goToPrevMonth,
        goToNextMonth,
        goToToday,
        // Admin Register OFF
        adminStaffList,
        adminRegisterLoading,
        adminRegisterOff,
    };
};

/**
 * Hook for Shift Management (admin side).
 */
export const useShiftManagement = () => {
    const { user } = useAuth();
    const [allShifts, setAllShifts] = useState<ShiftRecord[]>([]);
    const [pendingShifts, setPendingShifts] = useState<ShiftRecord[]>([]);
    const [isLoadingShifts, setIsLoadingShifts] = useState(true);
    const [shiftActionLoading, setShiftActionLoading] = useState<Record<string, string>>({});

    // Staff list for dropdown
    const [staffList, setStaffList] = useState<StaffOption[]>([]);
    const [isLoadingStaff, setIsLoadingStaff] = useState(false);

    // Assign modal state
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [assignEmployeeId, setAssignEmployeeId] = useState('');
    const [assignEmployeeName, setAssignEmployeeName] = useState('');
    const [assignShiftType, setAssignShiftType] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);

    const fetchShifts = useCallback(async (date?: string | null) => {
        setIsLoadingShifts(true);
        try {
            const dateParam = date ? `&date=${date}` : '';
            const [allResult, pendingResult] = await Promise.all([
                apiClient.get<any>(`${API.KTV.SHIFT}?all=true${dateParam}`).catch(() => ({ data: [] })),
                apiClient.get<any>(`${API.KTV.SHIFT}?pending=true`).catch(() => ({ data: [] })),
            ]);

            if (allResult.data) setAllShifts(allResult.data || []);
            if (pendingResult.data) setPendingShifts(pendingResult.data || []);
        } catch (err: any) {
            console.error('❌ [ShiftManagement] Fetch error:', err.message || err);
        } finally {
            setIsLoadingShifts(false);
        }
    }, []);

    // Fetch all active staff for dropdown
    const fetchStaffList = useCallback(async () => {
        setIsLoadingStaff(true);
        try {
            const result = await apiClient.get<any>(API.STAFF_LIST);
            if (result.data) {
                setStaffList(result.data || []);
            }
        } catch (err: any) {
            console.error('❌ [ShiftManagement] Fetch staff error:', err.message || err);
        } finally {
            setIsLoadingStaff(false);
        }
    }, []);

    useEffect(() => { fetchShifts(); }, [fetchShifts]);
    useEffect(() => { fetchStaffList(); }, [fetchStaffList]);

    // Approve / Reject shift change
    const handleShiftAction = async (shiftId: string, action: 'APPROVE' | 'REJECT') => {
        setShiftActionLoading(prev => ({ ...prev, [shiftId]: action.toLowerCase() }));
        try {
            await apiClient.patch<any>(API.KTV.SHIFT, { shiftId, action, adminId: user?.id });
            fetchShifts();
        } catch (err: any) {
            console.error('❌ [ShiftManagement] Action error:', err.message || err);
            alert(err.message || 'Lỗi xử lý');
        } finally {
            setShiftActionLoading(prev => { const next = { ...prev }; delete next[shiftId]; return next; });
        }
    };

    // Admin assigns shift directly
    const handleAssignShift = async () => {
        if (!assignEmployeeId || !assignShiftType) return;
        setIsAssigning(true);
        // Resolve employee name from staffList
        const selectedStaff = staffList.find(s => s.id === assignEmployeeId);
        const resolvedName = selectedStaff?.full_name || assignEmployeeId;
        try {
            await apiClient.post<any>(API.KTV.SHIFT, {
                employeeId: assignEmployeeId,
                employeeName: resolvedName,
                shiftType: assignShiftType,
                assignedByAdmin: true,
                adminId: user?.id,
            });
            setAssignModalOpen(false);
            setAssignEmployeeId('');
            setAssignEmployeeName('');
            setAssignShiftType('');
            fetchShifts();
        } catch (err: any) {
            console.error('❌ [ShiftManagement] Assign error:', err.message || err);
            alert(err.message || 'Lỗi gán ca');
        } finally {
            setIsAssigning(false);
        }
    };

    const openAssignModal = (employeeId?: string, employeeName?: string) => {
        setAssignEmployeeId(employeeId || '');
        setAssignEmployeeName(employeeName || '');
        setAssignShiftType('');
        setAssignModalOpen(true);
    };

    // Computed: KTVs who have an ACTIVE shift (by employeeId)
    const assignedEmployeeIds = useMemo(
        () => new Set(allShifts.map(s => s.employeeId)),
        [allShifts]
    );

    // KTVs without any active shift assignment
    const unassignedStaff = useMemo(
        () => staffList.filter(s => !assignedEmployeeIds.has(s.id)),
        [staffList, assignedEmployeeIds]
    );

    return {
        allShifts,
        pendingShifts,
        isLoadingShifts,
        shiftActionLoading,
        handleShiftAction,
        fetchShifts,
        // Staff dropdown
        staffList,
        isLoadingStaff,
        unassignedStaff,
        // Assign modal
        assignModalOpen,
        setAssignModalOpen,
        assignEmployeeId,
        setAssignEmployeeId,
        assignEmployeeName,
        setAssignEmployeeName,
        assignShiftType,
        setAssignShiftType,
        isAssigning,
        handleAssignShift,
        openAssignModal,
    };
};

// --- Helpers ---
function formatShortDate(dateStr: string): string {
    const [, m, d] = dateStr.split('-');
    return `${d}/${m}`;
}
