import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { KTV_WORK_TYPES, type KtvWorkType } from '@/lib/services/KtvRosterService';

export type WorkTypeFilter = 'ALL' | KtvWorkType;

/**
 * Loại D KHÔNG có ví điểm — thưởng 4★ của họ nằm thẳng trong tiền tua, nên
 * `/api/finance/ktv-bonus-summary` không trả dòng nào cho loại D. Cờ này để
 * giao diện nói rõ lý do thay vì hiện bảng trống khó hiểu.
 */
export const BONUS_WALLET_EXCLUDED_TYPES: KtvWorkType[] = ['TYPE_D'];

export function useFinanceKTV() {
    const { user, hasPermission } = useAuth();
    const [withdrawals, setWithdrawals] = useState<any[]>([]);
    const [summaries, setSummaries] = useState<any[]>([]);
    const [bonusSummaries, setBonusSummaries] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    // UI States
    const [activeTab, setActiveTab] = useState<'TUA' | 'BONUS'>('TUA');
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
    
    // Date Filters
    const [filterType, setFilterType] = useState<'ALL' | 'TODAY' | 'CUSTOM'>('ALL');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [filterStaffId, setFilterStaffId] = useState('ALL');
    const [filterWorkType, setFilterWorkType] = useState<WorkTypeFilter>('ALL');

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

    /** Số KTV mỗi loại — hiện ngay trên nhãn bộ lọc để biết loại nào rỗng. */
    const countsByType = useMemo(() => {
        const counts: Record<string, number> = { ALL: summaries.length };
        KTV_WORK_TYPES.forEach(t => { counts[t] = 0; });
        summaries.forEach(ktv => {
            const t = ktv.work_type || 'TYPE_A';
            if (counts[t] !== undefined) counts[t] += 1;
        });
        return counts;
    }, [summaries]);

    const matchWorkType = useCallback(
        (ktv: any) => filterWorkType === 'ALL' || (ktv.work_type || 'TYPE_A') === filterWorkType,
        [filterWorkType]
    );

    // Danh sách chọn KTV bám theo loại đang lọc: chọn "Loại D" thì dropdown chỉ
    // còn KTV loại D, khỏi phải dò trong cả trăm mã.
    const staffList = useMemo(() => {
        const list = new Map<string, string>();
        summaries.filter(matchWorkType).forEach(ktv => list.set(ktv.id, ktv.name));
        bonusSummaries.filter(matchWorkType).forEach(ktv => list.set(ktv.id, ktv.name));
        return Array.from(list.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
    }, [summaries, bonusSummaries, matchWorkType]);

    // Đổi loại mà KTV đang chọn không thuộc loại mới → bảng sẽ rỗng và người
    // dùng không hiểu vì sao. Thả về "Tất cả KTV".
    useEffect(() => {
        if (filterStaffId === 'ALL') return;
        if (!staffList.some(s => s.id === filterStaffId)) setFilterStaffId('ALL');
    }, [staffList, filterStaffId]);

    const filteredSummaries = useMemo(() => {
        return summaries
            .filter(matchWorkType)
            .filter(k => filterStaffId === 'ALL' || k.id === filterStaffId);
    }, [summaries, filterStaffId, matchWorkType]);

    const filteredBonusSummaries = useMemo(() => {
        return bonusSummaries
            .filter(matchWorkType)
            .filter(k => filterStaffId === 'ALL' || k.id === filterStaffId);
    }, [bonusSummaries, filterStaffId, matchWorkType]);

    /** Tab Ví Bonus đang lọc đúng loại không dùng ví điểm → giải thích, không để bảng trống. */
    const isBonusWalletExcluded = useMemo(
        () => filterWorkType !== 'ALL' && BONUS_WALLET_EXCLUDED_TYPES.includes(filterWorkType),
        [filterWorkType]
    );

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
        filterWorkType,
        setFilterWorkType,
        countsByType,
        isBonusWalletExcluded,
        staffList,
        filteredSummaries,
        filteredBonusSummaries
    };
}
