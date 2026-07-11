import { useState, useEffect, useCallback } from 'react';

export interface TimeBreakdown {
    timeRange: string;
    revenue: number;
    orders: number;
}

export interface WeekdayBreakdown {
    weekday: string;
    revenue: number;
    orders: number;
}

export interface KtvWorkingTime {
    ktvId: string;
    ktvCode: string;
    ktvName: string;
    totalServices: number;
    totalWorkingMinutes: number;
    totalRevenueContribution: number;
}

export const useRevenueTimeAnalysis = (dateFrom: string, dateTo: string, langFilter: string) => {
    const [timeBreakdown, setTimeBreakdown] = useState<TimeBreakdown[]>([]);
    const [weekdayBreakdown, setWeekdayBreakdown] = useState<WeekdayBreakdown[]>([]);
    const [ktvWorkingTime, setKtvWorkingTime] = useState<KtvWorkingTime[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTimeAnalysis = useCallback(async () => {
        if (!dateFrom || !dateTo) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ dateFrom, dateTo });
            if (langFilter && langFilter !== 'all') params.set('lang', langFilter);
            
            const res = await fetch(`/api/finance/reports/time-analysis?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setTimeBreakdown(json.timeBreakdown || []);
                setWeekdayBreakdown(json.weekdayBreakdown || []);
                setKtvWorkingTime(json.ktvWorkingTime || []);
            } else {
                setError(json.error || 'Failed to fetch time analysis data');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, langFilter]);

    useEffect(() => {
        fetchTimeAnalysis();
    }, [fetchTimeAnalysis]);

    return { timeBreakdown, weekdayBreakdown, ktvWorkingTime, isLoading, error, refetch: fetchTimeAnalysis };
};
