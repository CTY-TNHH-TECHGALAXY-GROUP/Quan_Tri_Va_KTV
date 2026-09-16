import { useState, useEffect, useCallback } from 'react';

export interface HourlyDetailRow {
    id: string;
    dateStr: string;
    lang: string;
    statusInfo: string;
    source: string;
    roomName: string;
    paymentMethod: string;
    duration: number;
    serviceName: string;
    ktv: string;
    startTime: string;
    endTime: string;
    revenue: number;
    tip: number;
    commission: number;
    statusText: string;
}

export const useRevenueHourlyDetails = (dateFrom: string, dateTo: string, langFilter: string, hour: number) => {
    const [data, setData] = useState<HourlyDetailRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchHourlyDetails = useCallback(async () => {
        if (!dateFrom || !dateTo || hour === null) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ dateFrom, dateTo, hour: hour.toString() });
            if (langFilter && langFilter !== 'all') params.set('lang', langFilter);
            
            const res = await fetch(`/api/finance/reports/hourly-details?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setData(json.data || []);
            } else {
                setError(json.error || 'Failed to fetch hourly details');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, langFilter, hour]);

    useEffect(() => {
        fetchHourlyDetails();
    }, [fetchHourlyDetails]);

    return { data, isLoading, error, refetch: fetchHourlyDetails };
};
