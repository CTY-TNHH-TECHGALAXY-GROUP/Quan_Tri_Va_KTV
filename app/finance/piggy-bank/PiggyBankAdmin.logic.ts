import { useState, useEffect } from 'react';

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
    const [editingData, setEditingData] = useState<{ [key: string]: { amount: number, weeks: number } }>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/piggy-bank');
            const data = await res.json();
            if (data.success) {
                setRecords(data.data || []);
                setTotalWeeks(data.totalWeeks || 50);
                
                // Init editing state
                const initEditing: { [key: string]: { amount: number, weeks: number } } = {};
                (data.data || []).forEach((r: PiggyBankRecord) => {
                    initEditing[r.staff_id] = { amount: r.weekly_amount, weeks: r.contributed_weeks };
                });
                setEditingData(initEditing);
            }
        } catch (error) {
            console.error('Lỗi lấy dữ liệu ví heo đất:', error);
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

    const saveAmount = async (staffId: string) => {
        try {
            setSavingId(staffId);
            const amount = editingData[staffId]?.amount || 0;
            const weeks = editingData[staffId]?.weeks || 0;
            const res = await fetch('/api/admin/piggy-bank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staff_id: staffId, weekly_amount: amount, contributed_weeks: weeks })
            });
            const result = await res.json();
            if (result.success) {
                // Update local state to reflect the change visually as saved
                setRecords(prev => prev.map(r => r.staff_id === staffId ? { ...r, weekly_amount: amount, contributed_weeks: weeks } : r));
            } else {
                alert('Có lỗi xảy ra khi lưu: ' + result.error);
            }
        } catch (error) {
            alert('Có lỗi kết nối khi lưu.');
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
        saveAmount,
        refresh: fetchData
    };
};
