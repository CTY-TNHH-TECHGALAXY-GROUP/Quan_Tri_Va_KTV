import { useState, useEffect, useCallback } from 'react';

export interface CustomerData {
    id: string;
    name: string;
    phone: string;
    email: string;
    orders: number;
    revenue: number;
    createdAt?: string;
}

export interface LanguageBreakdown {
    key: string;
    lang: string;
    revenue: number;
    orders: number;
}

export const useRevenueCustomers = (dateFrom: string, dateTo: string, langFilter: string) => {
    const [newCustomers, setNewCustomers] = useState<CustomerData[]>([]);
    const [topCustomers, setTopCustomers] = useState<CustomerData[]>([]);
    const [languageBreakdown, setLanguageBreakdown] = useState<LanguageBreakdown[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchCustomers = useCallback(async () => {
        if (!dateFrom || !dateTo) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ dateFrom, dateTo });
            if (langFilter && langFilter !== 'all') params.set('lang', langFilter);
            
            const res = await fetch(`/api/finance/reports/customers?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setNewCustomers(json.newCustomerList || []);
                setTopCustomers(json.topCustomersData || []);
                setLanguageBreakdown(json.languageBreakdown || []);
            } else {
                setError(json.error || 'Failed to fetch customers data');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, langFilter]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    return { newCustomers, topCustomers, languageBreakdown, isLoading, error, refetch: fetchCustomers };
};
