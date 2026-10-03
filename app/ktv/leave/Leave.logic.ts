'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

// 🔧 UI CONFIGURATION
const FETCH_RANGE_DAYS = 30; // Show leave schedule for the next 30 days

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

/**
 * Custom hook for KTV Leave page logic.
 * Handles fetching all leave schedules and submitting new leave requests.
 */
export const useKTVLeave = () => {
    const { hasPermission, user } = useAuth();
    const [date, setDate] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Leave schedule state
    const [leaveList, setLeaveList] = useState<LeaveRequest[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const canAccessPage = hasPermission('ktv_schedule');

    // --- Fetch leave schedule ---
    const fetchLeaveList = useCallback(async () => {
        setIsLoadingList(true);
        try {
            const today = new Date();
            const from = today.toISOString().split('T')[0];
            const toDate = new Date(today.getTime() + FETCH_RANGE_DAYS * 24 * 60 * 60 * 1000);
            const to = toDate.toISOString().split('T')[0];

            const result = await apiClient.get<any>(`${API.KTV.LEAVE}?from=${from}&to=${to}`);
            setLeaveList(result.data || []);
        } catch (err: any) {
            console.error('❌ [Leave] Fetch failed:', err.message || err);
        } finally {
            setIsLoadingList(false);
        }
    }, []);

    useEffect(() => {
        if (mounted && canAccessPage) {
            fetchLeaveList();
        }
    }, [mounted, canAccessPage, fetchLeaveList]);

    // --- Submit leave request ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!date || !user?.id) return;

        setIsSubmitting(true);
        setSubmitError(null);
        setSubmitSuccess(false);

        try {
            await apiClient.post<any>(API.KTV.LEAVE, {
                employeeId: user.id,
                employeeName: user.name || user.id,
                date,
                reason: "Xin nghỉ",
            });

            setSubmitSuccess(true);
            setDate('');

            // Refresh the leave list
            fetchLeaveList();

            // Auto-hide success after 3 seconds
            setTimeout(() => setSubmitSuccess(false), 3000);
        } catch (err: any) {
            setSubmitError(err.message || 'Lỗi không xác định');
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        date,
        isSubmitting,
        mounted,
        canAccessPage,
        leaveList,
        isLoadingList,
        submitError,
        submitSuccess,
        setDate,
        setSubmitError,
        handleSubmit,
        fetchLeaveList,
    };
};
