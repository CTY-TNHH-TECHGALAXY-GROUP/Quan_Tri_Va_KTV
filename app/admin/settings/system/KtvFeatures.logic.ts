'use client';

import { useState, useEffect, useCallback } from 'react';

// 🔧 FEATURE FLAG DEFINITIONS
export const FEATURE_FLAG_DEFS = [
    {
        key: 'laundry_deduction',
        label: '🧦 Trừ giặt đồ',
        description: 'Tự động trừ phí giặt đồ khi điểm danh',
    },
    {
        key: 'sudden_leave_penalty',
        label: '⚠️ Phạt nghỉ ĐX',
        description: 'Tự động trừ tiền phạt khi nghỉ đột xuất',
    },
    {
        key: 'allow_on_call',
        label: '🛵 Nhận đơn ngoài giờ',
        description: 'Cho phép KTV tự bật trạng thái sẵn sàng nhận đơn khi ở nhà',
    },
    {
        key: 'enable_employee_tasks',
        label: '📋 Bàn giao công việc',
        description: 'Hiển thị tab Công Việc / Bàn Giao trên ứng dụng của nhân viên',
    },
    {
        key: 'bonus_wallet',
        label: '💰 Ví Bonus',
        description: 'Tích điểm thưởng ca, tua vào ví Bonus',
    },
    {
        key: 'savings_wallet',
        label: '💎 Ví Tích Luỹ',
        description: 'Tích luỹ lâu dài',
    },
    {
        key: 'maintenance_fee',
        label: '🔧 Phí Bảo Trì',
        description: 'Tự động trừ phí bảo trì app hàng tháng',
    },
    {
        key: 'kpi_target_hours',
        label: '⏱️ KPI Demo',
        description: 'Bật hiển thị KPI cho KTV Loại A/C',
    },
    {
        key: 'internal_fund_enabled',
        label: 'Quỹ nội bộ',
        description: 'Tự động trừ tiền quỹ nội bộ TYPE_D',
    },
    {
        key: 'withdraw_morning_only',
        label: 'Rút tiền buổi sáng',
        description: 'Chỉ cho phép đăng ký rút tiền buổi sáng TYPE_D',
    }
] as const;

export type FeatureFlagKey = typeof FEATURE_FLAG_DEFS[number]['key'];

interface StaffFeature {
    id: string;
    full_name: string;
    status: string;
    feature_flags: Record<string, boolean>;
    work_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';
}

export const getDefaultFlagsForType = (workType: string): Record<string, boolean> => {
    switch (workType) {
        case 'TYPE_A':
            return {
                laundry_deduction: true,
                sudden_leave_penalty: true,
                allow_on_call: false,
                enable_employee_tasks: true,
                bonus_wallet: true,
                savings_wallet: true,
                maintenance_fee: true,
            };
        case 'TYPE_B':
            return {
                laundry_deduction: true,
                sudden_leave_penalty: false,
                allow_on_call: true,
                enable_employee_tasks: false,
                bonus_wallet: false,
                savings_wallet: false,
                maintenance_fee: true,
            };
        case 'TYPE_C':
            return {
                laundry_deduction: true,
                sudden_leave_penalty: false,
                allow_on_call: false,
                enable_employee_tasks: false,
                bonus_wallet: false,
                savings_wallet: false,
                maintenance_fee: true,
            };
        case 'TYPE_D':
            return {
                laundry_deduction: true,
                sudden_leave_penalty: false,
                allow_on_call: false,
                enable_employee_tasks: false,
                bonus_wallet: true,
                savings_wallet: false,
                maintenance_fee: true,
                internal_fund_enabled: true,
                withdraw_morning_only: true,
            };
        default:
            return {};
    }
};

export const useStaffFeatures = (activeTab?: string) => {
    const [staffList, setStaffList] = useState<StaffFeature[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/admin/staff-features?t=${Date.now()}`, { cache: 'no-store' });
            const json = await res.json();
            if (json.success) {
                setStaffList(json.data || []);
            }
        } catch (err) {
            console.error('Failed to fetch staff features:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const toggleFlag = useCallback(async (staffId: string, flagKey: string, newValue: boolean) => {
        const updateKey = `${staffId}-${flagKey}`;
        setUpdating(updateKey);

        // Optimistic update
        setStaffList(prev => prev.map(s =>
            s.id === staffId
                ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: newValue } }
                : s
        ));

        try {
            const res = await fetch('/api/admin/staff-features', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staffId, flagKey, value: newValue }),
            });
            const json = await res.json();
            if (!json.success) {
                // Revert on failure
                setStaffList(prev => prev.map(s =>
                    s.id === staffId
                        ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: !newValue } }
                        : s
                ));
            }
        } catch (err) {
            // Revert on error
            setStaffList(prev => prev.map(s =>
                s.id === staffId
                    ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: !newValue } }
                    : s
            ));
        } finally {
            setUpdating(null);
        }
    }, []);

    const updateWorkType = useCallback(async (staffId: string, newWorkType: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D') => {
        const updateKey = `${staffId}-worktype`;
        setUpdating(updateKey);

        const newFlags = getDefaultFlagsForType(newWorkType);

        // Optimistic update
        setStaffList(prev => prev.map(s =>
            s.id === staffId
                ? { ...s, work_type: newWorkType, feature_flags: newFlags }
                : s
        ));

        try {
            const res = await fetch('/api/admin/staff-features', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updateWorkType: true, staffId, workType: newWorkType, newFlags }),
            });
            const json = await res.json();
            if (!json.success) {
                // Revert on failure (we would ideally revert to original, but fetching again is safer)
                fetchData();
            }
        } catch (err) {
            fetchData();
        } finally {
            setUpdating(null);
        }
    }, [fetchData]);

    const bulkToggle = useCallback(async (flagKey: string, newValue: boolean) => {
        setUpdating(`bulk-${flagKey}`);

        // Optimistic update
        setStaffList(prev => prev.map(s => ({
            ...s,
            feature_flags: { ...s.feature_flags, [flagKey]: newValue }
        })));

        try {
            const staffIds = staffList.map(s => s.id);
            const res = await fetch('/api/admin/staff-features', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staffIds, flagKey, value: newValue }),
            });
            const json = await res.json();
            if (!json.success) {
                fetchData(); // revert
            }
        } catch (err) {
            fetchData();
        } finally {
            setUpdating(null);
        }
    }, [staffList, fetchData]);

    // Filter by tab type first
    const typeFilteredStaff = activeTab 
        ? staffList.filter(s => (s.work_type || 'TYPE_A') === activeTab)
        : staffList;

    // Filtered list by search
    const filteredStaff = typeFilteredStaff.filter(s =>
        s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return {
        staffList: filteredStaff,
        allStaffCount: typeFilteredStaff.length,
        loading,
        updating,
        searchQuery,
        setSearchQuery,
        toggleFlag,
        updateWorkType,
        bulkToggle,
        refetch: fetchData,
    };
};
