'use client';

import { useState, useEffect, useCallback } from 'react';
import { resolveStaffFlag } from '@/lib/featureFlags';
import { useToast } from '@/components/ui/Toast';

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
        // OFF keeps the menu visible; the page itself answers "Tính năng của
        // bạn đang bảo trì" (server returns FEATURE_MAINTENANCE). Hiding the
        // menu instead would tell the KTV nothing.
        key: 'history_page',
        label: '📜 Trang Lịch sử',
        description: 'Tắt = KTV vẫn thấy menu Lịch sử nhưng vào trang chỉ thấy "Tính năng của bạn đang bảo trì" (áp cho người còn quyền Lịch sử)',
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
    /** 'MANUAL' = switched off from this table; null = disciplinary / legacy lock. */
    lock_source?: string | null;
    feature_flags: Record<string, any>;
    work_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';
}

/** The "Hoạt động" switch reads the same state as Office's "Mở khóa" button. */
export const isAccountActive = (staff: { status: string }) => staff.status !== 'KHÓA_TÀI_KHOẢN';

/** What the unlock dialog needs — same data Office's unlock sheet uses. */
export interface UnlockInfo {
    lockReason: string | null;
    feeEnabled: boolean;
    feeMin: number;
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

    const { addToast } = useToast();

    /**
     * Lưu hỏng thì PHẢI nói.
     *
     * ⚠️ Cả bốn lời gọi trong file này đều chỉ lật cần gạt về chỗ cũ rồi im.
     * Admin bấm tắt, thấy nó tự bật lại, tưởng mình bấm hụt nên bấm tiếp — chứ
     * không biết là KHÔNG LƯU ĐƯỢC. Rồi sang màn KTV thấy tính năng vẫn chạy,
     * lại tưởng app hỏng.
     */
    const baoHong = (viec: string, ly?: string) =>
        addToast(`Không ${viec}: ${ly || 'máy chủ từ chối'}`, 'error');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/admin/staff-features?t=${Date.now()}`, { cache: 'no-store' });
            const json = await res.json();
            if (json.success) {
                setStaffList(json.data || []);
            } else {
                baoHong('tải được danh sách nhân viên', json.error);
            }
        } catch (err: any) {
            console.error('Failed to fetch staff features:', err);
            baoHong('tải được danh sách nhân viên', err?.message || 'lỗi kết nối');
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
            const lat = (ly?: string) => {
                setStaffList(prev => prev.map(s =>
                    s.id === staffId
                        ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: !newValue } }
                        : s
                ));
                baoHong(`${newValue ? 'bật' : 'tắt'} được tính năng cho ${staffId}`, ly);
            };
            if (!json.success) lat(json.error);
        } catch (err: any) {
            setStaffList(prev => prev.map(s =>
                s.id === staffId
                    ? { ...s, feature_flags: { ...s.feature_flags, [flagKey]: !newValue } }
                    : s
            ));
            baoHong(`${newValue ? 'bật' : 'tắt'} được tính năng cho ${staffId}`, err?.message || 'lỗi kết nối');
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
                baoHong(`đổi được loại KTV cho ${staffId}`, json.error);
                fetchData();   // nạp lại cho chắc, khỏi đoán trạng thái cũ
            }
        } catch (err: any) {
            baoHong(`đổi được loại KTV cho ${staffId}`, err?.message || 'lỗi kết nối');
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
                baoHong(`${newValue ? 'bật' : 'tắt'} được hàng loạt`, json.error);
                fetchData(); // revert
            }
        } catch (err: any) {
            baoHong(`${newValue ? 'bật' : 'tắt'} được hàng loạt`, err?.message || 'lỗi kết nối');
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

    /** GET /api/admin/staff/unlock — reason + reactivation fee floor, like Office. */
    const getUnlockInfo = useCallback(async (staffId: string): Promise<UnlockInfo | null> => {
        try {
            const res = await fetch(`/api/admin/staff/unlock?staffId=${encodeURIComponent(staffId)}`, { cache: 'no-store' });
            const json = await res.json();
            if (!json?.success) { baoHong('tải được thông tin mở khoá', json?.error); return null; }
            return {
                lockReason: json.data?.lockReason ?? null,
                feeEnabled: !!json.data?.feeEnabled,
                feeMin: Number(json.data?.feeMin || 0),
            };
        } catch (err: any) {
            baoHong('tải được thông tin mở khoá', err?.message || 'lỗi kết nối');
            return null;
        }
    }, []);

    /**
     * "Hoạt động" switch.
     *   OFF → POST /api/admin/staff/lock   (manual lock, KTV sees the maintenance notice)
     *   ON  → POST /api/admin/staff/unlock (the SAME route Office uses — reason,
     *         reactivation fee floor and audit log stay identical)
     * No optimistic flip: locking can be refused (order in flight), and a switch
     * that jumps back on its own reads as "I missed the button".
     */
    const setAccountActive = useCallback(async (
        staffId: string,
        active: boolean,
        reason: string,
        reactivationFee?: number,
    ): Promise<boolean> => {
        setUpdating(`${staffId}-active`);
        try {
            const res = await fetch(active ? '/api/admin/staff/unlock' : '/api/admin/staff/lock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(active
                    ? { staffId, reason, ...(reactivationFee !== undefined ? { reactivationFee } : {}) }
                    : { staffId, reason }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json?.success === false) {
                baoHong(active ? 'bật lại được tài khoản' : 'tắt được tài khoản', json?.error);
                return false;
            }
            setStaffList(prev => prev.map(s => s.id === staffId
                ? { ...s, status: active ? 'ĐANG LÀM' : 'KHÓA_TÀI_KHOẢN', lock_source: active ? null : 'MANUAL' }
                : s
            ));
            return true;
        } catch (err: any) {
            baoHong(active ? 'bật lại được tài khoản' : 'tắt được tài khoản', err?.message || 'lỗi kết nối');
            return false;
        } finally {
            setUpdating(null);
        }
    }, []);

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
        getUnlockInfo,
        setAccountActive,
        refetch: fetchData,
    };
};
