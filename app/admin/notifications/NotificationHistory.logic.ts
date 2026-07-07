'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

// --- TYPES ---
export interface NotificationItem {
    id: string;
    bookingId?: string;
    type: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    employeeId?: string;
    acknowledgedAt?: string;
    acknowledgedNote?: string;
}

export type FilterStatus = 'all' | 'pending' | 'completed' | 'acknowledged';

// 🔧 CONFIGURATION
const PAGE_SIZE = 15;

/**
 * Custom hook for Notification History page logic.
 * Handles fetching, filtering, pagination, and marking notifications.
 */
export const useNotificationHistory = () => {
    const { role } = useAuth();
    const router = useRouter();
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDate, setSelectedDate] = useState<string | null>(
        new Date().toISOString().split('T')[0]
    );
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);

    // --- DATA FETCHING ---
    const fetchNotifications = useCallback(async () => {
        setIsLoading(true);
        console.log('📡 [NotifHistory] Fetching with filter:', { filterStatus, selectedDate, page });

        try {
            let query = supabase
                .from('StaffNotifications')
                .select('*', { count: 'exact' })
                .order('isRead', { ascending: true })
                .order('createdAt', { ascending: false })
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            // Filter by date if selected
            if (selectedDate) {
                const startOfDay = `${selectedDate}T00:00:00Z`;
                const endOfDay = `${selectedDate}T23:59:59Z`;
                query = query.gte('createdAt', startOfDay).lte('createdAt', endOfDay);
            }

            // Filter by status
            if (filterStatus === 'pending') {
                query = query.eq('isRead', false);
            } else if (filterStatus === 'completed') {
                query = query.eq('isRead', true);
            } else if (filterStatus === 'acknowledged') {
                query = query.not('acknowledgedAt', 'is', null);
            }

            const { data, count, error } = await query;

            if (error) {
                console.error('❌ [NotifHistory] Error fetching notifications:', error);
            } else {
                setNotifications(data || []);
                setTotalCount(count || 0);
            }
        } catch (err) {
            console.error('❌ [NotifHistory] Critical error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [filterStatus, selectedDate, page]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    // --- HANDLERS ---
    const handleMarkDone = async (id: string, currentStatus: boolean) => {
        const { error } = await supabase
            .from('StaffNotifications')
            .update({ isRead: !currentStatus })
            .eq('id', id);

        if (!error) {
            setNotifications(prev =>
                prev.map(n => (n.id === id ? { ...n, isRead: !currentStatus } : n))
            );
        }
    };

    const handleAck = async (id: string, note: string) => {
        try {
            const res = await fetch('/api/ktv/interaction', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notificationId: id, note }),
            });
            const data = await res.json();
            if (data.success) {
                setNotifications(prev =>
                    prev.map(n => (n.id === id ? { ...n, acknowledgedAt: new Date().toISOString(), acknowledgedNote: note || 'Đã xác nhận', isRead: true } : n))
                );
            }
        } catch (error) {
            console.error('Ack error:', error);
        }
    };

    const handleFilterChange = (status: FilterStatus) => {
        setFilterStatus(status);
        setPage(0);
    };

    const handleRedirectToDispatch = () => {
        router.push('/reception/dispatch');
    };

    // --- COMPUTED VALUES ---
    const filteredNotifs = useMemo(() => {
        return notifications.filter(
            n =>
                n.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
                n.type.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [notifications, searchTerm]);

    const stats = useMemo(() => {
        const pending = notifications.filter(n => !n.isRead).length;
        return {
            pending,
            totalToday: totalCount,
        };
    }, [notifications, totalCount]);

    const hasNextPage = (page + 1) * PAGE_SIZE < totalCount;
    const hasPrevPage = page > 0;

    return {
        // State
        notifications,
        isLoading,
        filterStatus,
        searchTerm,
        selectedDate,
        page,
        totalCount,

        // Computed
        filteredNotifs,
        stats,
        hasNextPage,
        hasPrevPage,

        // Setters
        setSearchTerm,
        setSelectedDate,
        setPage,

        // Handlers
        fetchNotifications,
        handleMarkDone,
        handleAck,
        handleFilterChange,
        handleRedirectToDispatch,
    };
};
