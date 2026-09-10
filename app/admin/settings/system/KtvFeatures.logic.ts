'use client';

import { useState, useEffect, useCallback } from 'react';
import { resolveStaffFlag } from '@/lib/featureFlags';

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
        key: 'tua_wallet',
        label: '💰 VÍ TUA',
        description: 'Bật/tắt Ví Tua (Ví Thu Nhập đối với Type D)',
    },
    {
        key: 'bonus_wallet',
        label: '💎 VÍ BONUS',
        // Loại D: đây CHÍNH LÀ cần gạt "Ví Điểm theo Office" — bảng tự đổi nhãn
        // theo tab. Trước đây có thêm một cần gạt `bonus_from_office` riêng, gộp
        // rồi vì hai cái quản cùng một thứ.
        description: 'Loại A/B/C: tích điểm thưởng ca, tua vào ví Bonus. Loại D: Ví Điểm tính theo điểm Office, không quy đổi ra tiền — chỉ quyết định mức quỹ nội bộ phải đóng',
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
    feature_flags: Record<string, any>;
    work_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';
}

import {
    DEFAULT_FEATURE_FLAGS_TYPE_A,
    DEFAULT_FEATURE_FLAGS_TYPE_B,
    DEFAULT_FEATURE_FLAGS_TYPE_C,
    DEFAULT_FEATURE_FLAGS_TYPE_D
} from '@/lib/constants/staff.constants';

export const getDefaultFlagsForType = (workType: string): Record<string, any> => {
    switch (workType) {
        case 'TYPE_A':
            return DEFAULT_FEATURE_FLAGS_TYPE_A;
        case 'TYPE_B':
            return DEFAULT_FEATURE_FLAGS_TYPE_B;
        case 'TYPE_C':
            return DEFAULT_FEATURE_FLAGS_TYPE_C;
        case 'TYPE_D':
            return DEFAULT_FEATURE_FLAGS_TYPE_D;
        default:
            return {};
    }
};

/**
 * Danh sách đang HIỂN THỊ: lọc theo tab loại KTV rồi theo ô tìm kiếm.
 * Bảng, bộ đếm và nút "Bật hết / Tắt hết" phải dùng chung đúng hàm này —
 * lệch nhau một chỗ là thao tác hàng loạt đụng nhầm người.
 */
const selectVisibleStaff = (
    all: StaffFeature[],
    activeTab: string | undefined,
    searchQuery: string,
): StaffFeature[] => {
    const byType = activeTab
        ? all.filter(s => (s.work_type || 'TYPE_A') === activeTab)
        : all;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byType;
    return byType.filter(s =>
        s.full_name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
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

    /**
     * "Bật hết / Tắt hết" chỉ áp cho ĐÚNG danh sách đang hiển thị (đã lọc theo
     * tab loại KTV + ô tìm kiếm).
     *
     * ⚠️ Trước đây hàm này lấy `staffList` — state gốc chứa TOÀN BỘ nhân viên —
     * nên đứng ở tab Loại D bấm "Tắt hết" ví tua là tắt luôn ví của cả loại
     * A, B, C. Đó là lý do tắt ví ở một loại lại mất ví ở mọi tài khoản.
     */
    const bulkToggle = useCallback(async (flagKey: string, newValue: boolean) => {
        const staffIds = selectVisibleStaff(staffList, activeTab, searchQuery).map(s => s.id);
        if (staffIds.length === 0) return;

        setUpdating(`bulk-${flagKey}`);

        // Optimistic update — cũng chỉ đụng đúng những người trong tầm ảnh hưởng
        const targetSet = new Set(staffIds);
        setStaffList(prev => prev.map(s => targetSet.has(s.id)
            ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: newValue } }
            : s
        ));

        try {
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
    }, [staffList, activeTab, searchQuery, fetchData]);

    const typeFilteredStaff = activeTab
        ? staffList.filter(s => (s.work_type || 'TYPE_A') === activeTab)
        : staffList;
    const filteredStaff = selectVisibleStaff(staffList, activeTab, searchQuery);
    /** Số người sẽ bị ảnh hưởng nếu bấm "Bật hết / Tắt hết" ngay lúc này. */
    const bulkTargetCount = filteredStaff.length;

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
        bulkTargetCount,
        isFlagOn: (staff: StaffFeature, key: string) => resolveStaffFlag(staff.feature_flags, key),
        refetch: fetchData,
    };
};
