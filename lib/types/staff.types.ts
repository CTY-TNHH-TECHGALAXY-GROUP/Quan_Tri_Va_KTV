export type WorkType = 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';
export type OnlineStatus = 'OFFLINE' | 'ONLINE' | 'AT_VENUE';

export interface FeatureFlagsTypeD {
    laundry_deduction: boolean;
    sudden_leave_penalty: boolean;
    allow_on_call: boolean;
    enable_employee_tasks: boolean;
    bonus_wallet: boolean;
    savings_wallet: boolean;
    maintenance_fee: boolean;
    internal_fund_enabled: boolean;
    withdraw_morning_only: boolean;
    [key: string]: any;
}

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
