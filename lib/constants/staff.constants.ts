import { FeatureFlagsTypeA, FeatureFlagsTypeB, FeatureFlagsTypeD } from '../types/staff.types';

export const DEFAULT_KPI_TARGET_HOURS = 80;
export const DEFAULT_TRAVEL_MINUTES = 15;

export const WORK_TYPE_LABELS = {
    TYPE_A: 'Cơ bản',
    TYPE_B: 'Hợp tác',
    TYPE_C: 'Nhập tay',
    TYPE_D: 'Khoán'
};

export const DEFAULT_FEATURE_FLAGS_TYPE_A: FeatureFlagsTypeA = {
    overtime_enabled: true,
    shift_bonus_enabled: true,
    laundry_deduction: true,
    sudden_leave_penalty: true,
    allow_on_call: false,
    enable_employee_tasks: true,
    tua_wallet: true,
    bonus_wallet: true,
    maintenance_fee: true,
    history_page: true,
};

export const DEFAULT_FEATURE_FLAGS_TYPE_B: FeatureFlagsTypeB = {
    fixed_order_bonus_enabled: true,
    vip_menu_enabled: true,
    kpi_target_hours: DEFAULT_KPI_TARGET_HOURS,
    laundry_deduction: true,
    sudden_leave_penalty: false,
    allow_on_call: true,
    enable_employee_tasks: false,
    tua_wallet: true,
    bonus_wallet: false,
    maintenance_fee: true,
    history_page: true,
};

export const DEFAULT_FEATURE_FLAGS_TYPE_C = {
    laundry_deduction: true,
    sudden_leave_penalty: false,
    allow_on_call: true,
    enable_employee_tasks: false,
    tua_wallet: true,
    bonus_wallet: false,
    maintenance_fee: true,
    history_page: true,
};

export const DEFAULT_FEATURE_FLAGS_TYPE_D: FeatureFlagsTypeD = {
    laundry_deduction: true,
    sudden_leave_penalty: false,
    allow_on_call: true, // Sửa thành true
    enable_employee_tasks: false,
    tua_wallet: true,
    bonus_wallet: true,
    maintenance_fee: true,
    history_page: true,
    withdraw_morning_only: true
};

export const TYPE_D_DISCIPLINE_PENALTIES = {
    ABSENT_NO_NOTICE: 10,
    ABSENT_EARLY_NOTICE: 5,
    LATE_NO_UPDATE: 5,
    ORDER_REJECT_MULTIPLIER: 3
} as const;

export const TYPE_D_RATING_DEDUCTION = {
    4: 0,
    3: 0.25,
    2: 0.50,
    1: 0.75,
    0: 0
} as const;

export const TYPE_D_BONUS = {
    BASE_POINTS: 20
} as const;

/**
 * Nhãn hiển thị KTV trong thông báo và màn hình vận hành.
 *
 * Loại A / B / D là nhân sự nội bộ, quầy gọi nhau bằng MÃ (T079, NH016) nên
 * hiện tên đầy đủ vừa dài vừa khó đối chiếu với bảng điều phối.
 * Riêng loại C ("Nhập tay") là người nhập thủ công, mã chỉ là chuỗi sinh tự động
 * (EXT_G6AMZG…) không ai đọc được — nhóm này phải hiện TÊN.
 */
export function ktvDisplayLabel(
    workType: string | null | undefined,
    code: string,
    fullName?: string | null
): string {
    if (String(workType || '').toUpperCase() === 'TYPE_C') {
        return fullName?.trim() || code;
    }
    return code;
}
