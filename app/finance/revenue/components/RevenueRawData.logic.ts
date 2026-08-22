import { useState, useEffect, useCallback } from 'react';

export interface RawDataRow {
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

export const useRevenueRawData = (dateFrom: string, dateTo: string, langFilter: string) => {
    const [data, setData] = useState<RawDataRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchRawData = useCallback(async () => {
        if (!dateFrom || !dateTo) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ dateFrom, dateTo });
            if (langFilter && langFilter !== 'all') {
                params.set('lang', langFilter);
            }
            const res = await fetch(`/api/finance/reports/raw-data?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setData(json.rawDataSheet || []);
            } else {
                setError(json.error || 'Failed to fetch raw data');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, langFilter]);

    useEffect(() => {
        fetchRawData();
    }, [fetchRawData]);

    return { data, isLoading, error, refetch: fetchRawData };
};
