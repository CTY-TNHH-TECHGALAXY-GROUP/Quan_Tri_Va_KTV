import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export function useFinanceKTV() {
    const { user, hasPermission } = useAuth();
    const [withdrawals, setWithdrawals] = useState<any[]>([]);
    const [summaries, setSummaries] = useState<any[]>([]);
    const [bonusSummaries, setBonusSummaries] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    // UI States
    const [activeTab, setActiveTab] = useState<'TUA' | 'BONUS' | 'TICH_LUY'>('TUA');
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
    
    // Date Filters
    const [filterType, setFilterType] = useState<'ALL' | 'TODAY' | 'CUSTOM'>('ALL');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [filterStaffId, setFilterStaffId] = useState('ALL');

    // Adjustment Modal State
    const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
    const [selectedKtv, setSelectedKtv] = useState<{id: string, name: string} | null>(null);
    const [adjAmount, setAdjAmount] = useState('');
    const [adjType, setAdjType] = useState('GIFT');
    const [adjWalletType, setAdjWalletType] = useState('TUA'); // TUA or BONUS
    const [adjReason, setAdjReason] = useState('');
    
    const canAccessPage = hasPermission('finance_management');

    const fetchData = useCallback(async () => {
        try {
            let queryParams = '';
            if (filterType === 'TODAY') {
                const today = new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
                const todayStr = new Date(today).toISOString().split('T')[0];
                queryParams = `?fromDate=${todayStr}&toDate=${todayStr}`;
            } else if (filterType === 'CUSTOM' && fromDate && toDate) {
                queryParams = `?fromDate=${fromDate}&toDate=${toDate}`;
            }

            // Lấy Withdrawals (Luôn lấy mới nhất không phụ thuộc ngày)
            const wData = await apiClient.get<any>(`${API.FINANCE.WITHDRAWALS}?limit=50`);
            setWithdrawals(wData.data || []);

            // Lấy Summaries (Phase 3)
            const sData = await apiClient.get<any>(`${API.FINANCE.KTV_SUMMARY}${queryParams}`);
            setSummaries(sData.data || []);

            // Lấy Bonus Summaries
            const bData = await apiClient.get<any>(`${API.FINANCE.KTV_BONUS_SUMMARY}${queryParams}`);
            setBonusSummaries(bData.data || []);
        } catch (error: any) {
            console.error('Error fetching data:', error.message || error);
        } finally {
            setIsLoading(false);
        }
    }, [filterType, fromDate, toDate]);

    useEffect(() => {
        fetchData();
        // 🔧 EGRESS FIX: Finance page doesn't need real-time refresh
        // Reduced from 15s to 5 minutes. Data also refreshes after approve/reject/adjust actions.
        const interval = setInterval(fetchData, 300000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleApprove = async (id: string, amount: number) => {
        if (!user) return alert('Bạn cần đăng nhập để thao tác');
        if (!confirm(`Xác nhận bạn ĐÃ GIAO ${amount.toLocaleString()}đ tiền mặt cho KTV này?`)) return;

        setIsProcessing(true);
        try {
            await apiClient.patch<any>(`${API.FINANCE.WITHDRAWALS}/${id}`, { 
                status: 'APPROVED', 
                adminId: user.id,
                adminName: user.name || user.id
            });
            alert('Đã xác nhận giao tiền thành công!');
            fetchData(); // Refresh
        } catch (e: any) {
            alert('Lỗi hệ thống khi cập nhật: ' + (e.message || e));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (id: string) => {
        if (!user) return alert('Bạn cần đăng nhập để thao tác');
        const note = prompt('Nhập lý do từ chối (bắt buộc):');
        if (!note) return;

        setIsProcessing(true);
        try {
            await apiClient.patch<any>(`${API.FINANCE.WITHDRAWALS}/${id}`, { 
                status: 'REJECTED', 
                note,
                adminId: user.id,
                adminName: user.name || user.id
            });
            alert('Đã từ chối yêu cầu rút tiền.');
            fetchData(); // Refresh
        } catch (e: any) {
            alert('Lỗi hệ thống khi cập nhật: ' + (e.message || e));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleAcknowledgeIntent = async (id: string) => {
        setIsProcessing(true);
        try {
            await apiClient.patch<any>(`${API.FINANCE.WITHDRAWALS}/${id}`, { 
                status: 'REJECTED', 
                note: 'Đã chuẩn bị xong',
                adminId: user?.id || 'SYSTEM',
                adminName: user?.name || 'Hệ thống'
            });
            fetchData();
        } catch (e) {
            console.error(e);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleOpenAdjustment = (ktvId: string, ktvName: string) => {
        setSelectedKtv({ id: ktvId, name: ktvName });
        setAdjAmount('');
        setAdjReason('');
        setAdjType('GIFT');
        setAdjWalletType('TUA');
        setIsAdjustmentModalOpen(true);
    };

    const handleSubmitAdjustment = async () => {
        if (!selectedKtv) return;
        if (!adjAmount || !adjReason) {
            alert('Vui lòng nhập số tiền và lý do.');
            return;
        }

        const numericAmount = Number(adjAmount.replace(/[^0-9]/g, ''));
        if (numericAmount <= 0) {
            alert('Số tiền không hợp lệ.');
            return;
        }

        if (confirm(`Bạn có chắc chắn muốn ${adjType === 'GIFT' ? 'Thưởng' : 'Phạt'} KTV ${selectedKtv.name} số tiền ${numericAmount.toLocaleString()}đ?`)) {
            setIsProcessing(true);
            try {
                await apiClient.post<any>(API.FINANCE.ADJUSTMENT, {
                    staff_id: selectedKtv.id,
                    amount: numericAmount,
                    type: adjType,
                    wallet_type: adjWalletType,
                    reason: adjReason
                });

                alert('Đã thêm giao dịch điều chỉnh thành công!');
                setIsAdjustmentModalOpen(false);
                fetchData();
            } catch (error: any) {
                console.error('Error creating adjustment:', error.message || error);
                alert('Có lỗi xảy ra khi tạo giao dịch điều chỉnh: ' + (error.message || 'Unknown Error'));
            } finally {
                setIsProcessing(false);
            }
        }
    };

    const staffList = useMemo(() => {
        const list = new Map<string, string>();
        summaries.forEach(ktv => list.set(ktv.id, ktv.name));
        bonusSummaries.forEach(ktv => list.set(ktv.id, ktv.name));
        return Array.from(list.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
    }, [summaries, bonusSummaries]);

    const filteredSummaries = useMemo(() => {
        if (filterStaffId === 'ALL') return summaries;
        return summaries.filter(k => k.id === filterStaffId);
    }, [summaries, filterStaffId]);

    const filteredBonusSummaries = useMemo(() => {
        if (filterStaffId === 'ALL') return bonusSummaries;
        return bonusSummaries.filter(k => k.id === filterStaffId);
    }, [bonusSummaries, filterStaffId]);

    return {
        user,
        canAccessPage,
        withdrawals,
        summaries,
        bonusSummaries,
        isLoading,
        isProcessing,
        activeTab,
        setActiveTab,
        isHistoryExpanded,
        setIsHistoryExpanded,
        filterType,
        setFilterType,
        fromDate,
        setFromDate,
        toDate,
        setToDate,
        isAdjustmentModalOpen,
        selectedKtv,
        adjAmount,
        setAdjAmount,
        adjType,
        setAdjType,
        adjWalletType,
        setAdjWalletType,
        adjReason,
        setAdjReason,
        setIsAdjustmentModalOpen,
        handleApprove,
        handleReject,
        handleAcknowledgeIntent,
        handleOpenAdjustment,
        handleSubmitAdjustment,
        refresh: fetchData,
        filterStaffId,
        setFilterStaffId,
        staffList,
        filteredSummaries,
        filteredBonusSummaries
    };
}
