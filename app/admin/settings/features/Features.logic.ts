'use client';

import { useState, useEffect, useCallback } from 'react';

// 🔧 FEATURE FLAG DEFINITIONS
// Add new feature flags here when needed
export const FEATURE_FLAG_DEFS = [
    {
        key: 'laundry_deduction',
        label: '🧦 Trừ giặt đồ',
        description: 'Tự động trừ phí giặt đồ khi điểm danh',
        configKey: 'laundry_fee',
    },
    {
        key: 'sudden_leave_penalty',
        label: '⚠️ Phạt nghỉ ĐX',
        description: 'Tự động trừ tiền phạt khi nghỉ đột xuất',
        configKey: 'sudden_off_penalty',
    },
    {
        key: 'enable_bonus_wallet',
        label: '⭐ Ví Bonus',
        description: 'Cho phép KTV sử dụng và quy đổi Ví Điểm Thưởng',
        configKey: null,
    },
    {
        key: 'enable_piggy_wallet',
        label: '🐷 Ví Tích Luỹ',
        description: 'Bật tính năng Ví Tích Luỹ cho nhân viên',
        configKey: null,
    },
    {
        key: 'allow_on_call',
        label: '🛵 Nhận đơn ngoài giờ',
        description: 'Cho phép KTV tự bật trạng thái sẵn sàng nhận đơn khi ở nhà',
        configKey: null,
    },
    {
        key: 'enable_employee_tasks',
        label: '📋 Bàn giao công việc',
        description: 'Hiển thị tab Công Việc / Bàn Giao trên ứng dụng của nhân viên',
        configKey: null,
    },
] as const;

export type FeatureFlagKey = typeof FEATURE_FLAG_DEFS[number]['key'];

interface StaffFeature {
    id: string;
    full_name: string;
    status: string;
    feature_flags: Record<string, boolean>;
}

interface ConfigValues {
    laundry_fee: number;
    sudden_off_penalty: number;
}

export const useStaffFeatures = () => {
    const [staffList, setStaffList] = useState<StaffFeature[]>([]);
    const [configs, setConfigs] = useState<ConfigValues>({ laundry_fee: 20000, sudden_off_penalty: 500000 });
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null); // "staffId-flagKey" being updated
    const [searchQuery, setSearchQuery] = useState('');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/staff-features');
            const json = await res.json();
            if (json.success) {
                setStaffList(json.data || []);
                setConfigs(json.configs || { laundry_fee: 20000, sudden_off_penalty: 500000 });
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
                console.error('Toggle failed:', json.error);
            }
        } catch (err) {
            // Revert on error
            setStaffList(prev => prev.map(s =>
                s.id === staffId
                    ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: !newValue } }
                    : s
            ));
            console.error('Toggle error:', err);
        } finally {
            setUpdating(null);
        }
    }, []);

    const bulkToggle = useCallback(async (flagKey: string, value: boolean) => {
        const allIds = staffList.map(s => s.id);
        setUpdating(`bulk-${flagKey}`);

        // Optimistic update
        setStaffList(prev => prev.map(s => ({
            ...s,
            feature_flags: { ...s.feature_flags, [flagKey]: value }
        })));

        try {
            const res = await fetch('/api/admin/staff-features', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staffIds: allIds, flagKey, value }),
            });
            const json = await res.json();
            if (!json.success) {
                await fetchData(); // Revert by refetching
                console.error('Bulk toggle failed:', json.error);
            }
        } catch (err) {
            await fetchData();
            console.error('Bulk toggle error:', err);
        } finally {
            setUpdating(null);
        }
    }, [staffList, fetchData]);

    // Filtered list
    const filteredStaff = staffList.filter(s => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return s.id.toLowerCase().includes(q) || (s.full_name || '').toLowerCase().includes(q);
    });

    // Stats per flag
    const flagStats = FEATURE_FLAG_DEFS.reduce((acc, def) => {
        const enabled = staffList.filter(s => s.feature_flags?.[def.key] === true).length;
        acc[def.key] = { enabled, total: staffList.length };
        return acc;
    }, {} as Record<string, { enabled: number; total: number }>);

    return {
        staffList: filteredStaff,
        allStaffCount: staffList.length,
        configs,
        loading,
        updating,
        searchQuery,
        setSearchQuery,
        toggleFlag,
        bulkToggle,
        flagStats,
        refetch: fetchData,
    };
};
