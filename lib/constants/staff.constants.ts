import { FeatureFlagsTypeA, FeatureFlagsTypeB } from '../types/staff.types';

export const DEFAULT_KPI_TARGET_HOURS = 80;
export const DEFAULT_TRAVEL_MINUTES = 15;

export const WORK_TYPE_LABELS = {
    TYPE_A: 'Cơ bản',
    TYPE_B: 'Hợp tác',
    TYPE_C: 'Nhập tay'
};

export const DEFAULT_FEATURE_FLAGS_TYPE_A: FeatureFlagsTypeA = {
    overtime_enabled: true,
    shift_bonus_enabled: true
};

export const DEFAULT_FEATURE_FLAGS_TYPE_B: FeatureFlagsTypeB = {
    fixed_order_bonus_enabled: true,
    vip_menu_enabled: true,
    kpi_target_hours: DEFAULT_KPI_TARGET_HOURS
};
