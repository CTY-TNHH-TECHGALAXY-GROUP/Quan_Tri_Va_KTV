import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export type PiggyBankRecord = {
    staff_id: string;
    full_name: string;
    piggy_bank_id: string | null;
    weekly_amount: number;
    contributed_weeks: number;
    status: string;
};

export const usePiggyBankAdminLogic = () => {
    const [records, setRecords] = useState<PiggyBankRecord[]>([]);
    const [totalWeeks, setTotalWeeks] = useState<number>(50);
    const [loading, setLoading] = useState(true);
    const [editingData, setEditingData] = useState<{ [key: string]: { amount: number, weeks: number, status: string } }>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const data = await apiClient.get<any>(API.ADMIN.PIGGY_BANK);
            setRecords(data.data || []);
            setTotalWeeks(data.totalWeeks || 50);
            
            // Init editing state
            const initEditing: { [key: string]: { amount: number, weeks: number, status: string } } = {};
            (data.data || []).forEach((r: PiggyBankRecord) => {
                initEditing[r.staff_id] = { 
                    amount: r.weekly_amount, 
                    weeks: r.contributed_weeks, 
                    status: r.status 
                };
            });
            setEditingData(initEditing);
        } catch (error: any) {
            console.error('Lỗi lấy dữ liệu ví heo đất:', error.message || error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAmountChange = (staffId: string, value: string) => {
        const num = parseInt(value.replace(/\D/g, '')) || 0;
        setEditingData(prev => ({ 
            ...prev, 
            [staffId]: { ...prev[staffId], amount: num } 
        }));
    };

    const handleWeeksChange = (staffId: string, value: string) => {
        const num = parseInt(value.replace(/\D/g, '')) || 0;
        setEditingData(prev => ({ 
            ...prev, 
            [staffId]: { ...prev[staffId], weeks: num } 
        }));
    };

    const handleStatusChange = (staffId: string, status: string) => {
        setEditingData(prev => ({ 
            ...prev, 
            [staffId]: { ...prev[staffId], status } 
        }));
    };

    const saveAmount = async (staffId: string) => {
        try {
            setSavingId(staffId);
            const amount = editingData[staffId]?.amount || 0;
            const weeks = editingData[staffId]?.weeks || 0;
            const status = editingData[staffId]?.status || 'ACTIVE';
            
            await apiClient.post<any>(API.ADMIN.PIGGY_BANK, { 
                staff_id: staffId, 
                weekly_amount: amount, 
                contributed_weeks: weeks, 
                status 
            });
            
            // Update local state to reflect the change visually as saved
            setRecords(prev => prev.map(r => r.staff_id === staffId ? { ...r, weekly_amount: amount, contributed_weeks: weeks, status } : r));
        } catch (error: any) {
            alert('Có lỗi kết nối khi lưu: ' + (error.message || ''));
        } finally {
            setSavingId(null);
        }
    };

    return {
        records,
        totalWeeks,
        loading,
        editingData,
        savingId,
        handleAmountChange,
        handleWeeksChange,
        handleStatusChange,
        saveAmount,
        refresh: fetchData
    };
};
