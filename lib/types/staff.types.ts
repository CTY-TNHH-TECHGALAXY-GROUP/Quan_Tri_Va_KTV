export type WorkType = 'TYPE_A' | 'TYPE_B' | 'TYPE_C';
export type OnlineStatus = 'OFFLINE' | 'ONLINE' | 'AT_VENUE';

export interface FeatureFlagsTypeA {
    overtime_enabled: boolean;
    shift_bonus_enabled: boolean;
    [key: string]: any;
}

export interface FeatureFlagsTypeB {
    fixed_order_bonus_enabled: boolean;
    vip_menu_enabled: boolean;
    kpi_target_hours: number;
    [key: string]: any;
}
