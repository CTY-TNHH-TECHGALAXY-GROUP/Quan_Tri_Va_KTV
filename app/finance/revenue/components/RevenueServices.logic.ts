import { useState, useEffect, useCallback, useMemo } from 'react';

export interface ServiceBreakdown {
    name: string;
    revenue: number;
    count: number;
    duration: number;
    category: string;
}

export interface MenuEvaluation {
    id: number;
    code: string;
    name: string;
    duration: number;
    category: string;
    orders: number;
    revenue: number;
}

export const useRevenueServices = (dateFrom: string, dateTo: string, langFilter: string) => {
    const [breakdown, setBreakdown] = useState<ServiceBreakdown[]>([]);
    const [menuEvaluation, setMenuEvaluation] = useState<MenuEvaluation[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchServices = useCallback(async () => {
        if (!dateFrom || !dateTo) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ dateFrom, dateTo });
            if (langFilter && langFilter !== 'all') params.set('lang', langFilter);
            
            const res = await fetch(`/api/finance/reports/services?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setBreakdown(json.serviceBreakdown || []);
                setMenuEvaluation(json.menuEvaluation || []);
            } else {
                setError(json.error || 'Failed to fetch services data');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, langFilter]);

    useEffect(() => {
        fetchServices();
    }, [fetchServices]);

    // Gom nhóm các dịch vụ giống nhau nhưng khác thời lượng
    const durationPopularity = useMemo(() => {
        const groups: Record<string, { category: string, totalOrders: number, items: MenuEvaluation[] }> = {};
        
        menuEvaluation.forEach(item => {
            // Loại bỏ các con số chỉ phút ở cuối tên (VD: "Body massage 60'" -> "Body massage")
            let baseName = item.name.replace(/\s*\d+\s*(mins?|'|p|phút).*$/i, '').trim();
            if (!groups[baseName]) {
                groups[baseName] = { category: item.category, totalOrders: 0, items: [] };
            }
            groups[baseName].items.push(item);
            groups[baseName].totalOrders += item.orders;
        });

        // Chỉ lấy những nhóm có nhiều hơn 1 duration (để có thể so sánh)
        const result = Object.entries(groups)
            .filter(([, data]) => data.items.length > 1 && data.totalOrders > 0)
            .map(([name, data]) => ({
                baseName: name,
                category: data.category,
                totalOrders: data.totalOrders,
                items: data.items.sort((a, b) => a.duration - b.duration) // Sort by duration
            }))
            .sort((a, b) => b.totalOrders - a.totalOrders); // Sort by most popular base service

        return result;
    }, [menuEvaluation]);

    return { breakdown, menuEvaluation, durationPopularity, isLoading, error, refetch: fetchServices };
};
