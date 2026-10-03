'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

/**
 * Custom hook for KTV Performance page logic.
 * Currently uses mock data — can be extended with Supabase later.
 */
export const useKTVPerformance = () => {
    const { hasPermission } = useAuth();
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const canAccessPage = hasPermission('ktv_performance');

    // Mock KPI data (sẽ thay bằng Supabase khi tích hợp)
    const kpiData = {
        attendance: { value: 100, progress: 0 },
        process: { value: 85, progress: -15 },
        attitude: { value: 95, progress: -5 },
        total: '93.3',
    };

    // Mock income data
    const incomeData = {
        total: '8,450,000đ',
        salary: '4,000,000đ',
        turnFee: '2,250,000đ',
        tip: '1,700,000đ',
        bonus: '+500,000đ',
    };

    return {
        mounted,
        canAccessPage,
        kpiData,
        incomeData,
    };
};
