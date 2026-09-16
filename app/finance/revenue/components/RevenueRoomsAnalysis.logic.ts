import { useState, useEffect, useCallback } from 'react';

export interface RoomServiceDetail {
    name: string;
    count: number;
}

export interface RoomAnalysisRow {
    roomName: string;
    totalServices: number;
    services: RoomServiceDetail[];
}

export const useRevenueRoomsAnalysis = (dateFrom: string, dateTo: string, langFilter: string) => {
    const [data, setData] = useState<RoomAnalysisRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchRoomsData = useCallback(async () => {
        if (!dateFrom || !dateTo) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ dateFrom, dateTo });
            if (langFilter && langFilter !== 'all') params.set('lang', langFilter);
            
            const res = await fetch(`/api/finance/reports/rooms?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setData(json.data || []);
            } else {
                setError(json.error || 'Failed to fetch rooms analysis data');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, langFilter]);

    useEffect(() => {
        fetchRoomsData();
    }, [fetchRoomsData]);

    return { data, isLoading, error, refetch: fetchRoomsData };
};
