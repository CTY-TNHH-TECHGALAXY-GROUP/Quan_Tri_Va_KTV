import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';

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
            const res = await fetch('/api/finance/withdrawals?limit=50');
            const json = await res.json();
            if (json.success) setWithdrawals(json.data);

            // Lấy Summaries (Phase 3)
            const resSum = await fetch(`/api/finance/ktv-summary${queryParams}`);
            const jsonSum = await resSum.json();
            if (jsonSum.success) setSummaries(jsonSum.data);

            // Lấy Bonus Summaries
            const resBonus = await fetch(`/api/finance/ktv-bonus-summary${queryParams}`);
            const jsonBonus = await resBonus.json();
            if (jsonBonus.success) setBonusSummaries(jsonBonus.data);
        } catch (error) {
            console.error('Error fetching data:', error);
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
            const res = await fetch(`/api/finance/withdrawals/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'APPROVED', 
                    adminId: user.id,
                    adminName: user.name || user.id
                })
            });
            const json = await res.json();
            if (json.success) {
                alert('Đã xác nhận giao tiền thành công!');
                fetchData(); // Refresh
            } else {
                alert('Lỗi: ' + json.error);
            }
        } catch (e) {
            alert('Lỗi hệ thống khi cập nhật');
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
            const res = await fetch(`/api/finance/withdrawals/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'REJECTED', 
                    note,
                    adminId: user.id,
                    adminName: user.name || user.id
                })
            });
            const json = await res.json();
            if (json.success) {
                alert('Đã từ chối yêu cầu rút tiền.');
                fetchData(); // Refresh
            } else {
                alert('Lỗi: ' + json.error);
            }
        } catch (e) {
            alert('Lỗi hệ thống khi cập nhật');
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
                const res = await fetch('/api/finance/adjustment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        staff_id: selectedKtv.id,
                        amount: numericAmount,
                        type: adjType,
                        wallet_type: adjWalletType,
                        reason: adjReason
                    })
                });

                if (res.ok) {
                    alert('Đã thêm giao dịch điều chỉnh thành công!');
                    setIsAdjustmentModalOpen(false);
                    fetchData();
                } else {
                    const data = await res.json();
                    alert(`Lỗi: ${data.error}`);
                }
            } catch (error) {
                console.error('Error creating adjustment:', error);
                alert('Có lỗi xảy ra khi tạo giao dịch điều chỉnh.');
            } finally {
                setIsProcessing(false);
            }
        }
    };

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
        handleOpenAdjustment,
        handleSubmitAdjustment,
        refresh: fetchData
    };
}
