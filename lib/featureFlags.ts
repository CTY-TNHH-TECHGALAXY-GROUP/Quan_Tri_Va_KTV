/**
 * Nguồn sự thật DUY NHẤT cho cờ tính năng của KTV.
 *
 * Trước đây mỗi nơi tự quyết định "cờ thiếu thì tính là gì":
 *   · bảng admin  đọc `feature_flags[key] === true`   → thiếu = TẮT
 *   · app KTV     đọc `feature_flags.tua_wallet !== false` → thiếu = BẬT
 * Nên tài khoản cũ chưa từng set cờ hiện OFF bên admin mà KTV vẫn xem được ví.
 * Giờ cả hai bên gọi chung `resolveStaffFlag`, không ai tự chế mặc định nữa.
 *
 * Giá trị mặc định bên dưới GIỮ NGUYÊN hành vi mà code cũ đang chạy thật ở
 * phía tiêu thụ (server/app), không phải theo DEFAULT_FEATURE_FLAGS_* — mấy
 * hằng đó chỉ dùng lúc TẠO nhân viên mới.
 */

/** Cờ thiếu trong `Staff.feature_flags` thì hiểu là gì. */
export const FLAG_DEFAULT_WHEN_MISSING: Record<string, boolean> = {
    // Ví: chỉ ví tua là mặc định BẬT (app đang đọc `!== false`)
    tua_wallet: true,
    bonus_wallet: false,
    savings_wallet: false,
    // Trừ tiền tự động: mặc định KHÔNG trừ, trừ phí bảo trì đọc `=== false`
    laundry_deduction: false,
    sudden_leave_penalty: false,
    maintenance_fee: true,
    internal_fund_enabled: false,
    // Quyền thao tác
    allow_on_call: false,
    enable_employee_tasks: false,
    withdraw_morning_only: false,
    kpi_target_hours: false,
    enable_bonus: true,
    // Ví Điểm của loại D lấy điểm từ đâu: TẮT = điểm sao khách chấm (mặc định
    // cũ, giữ nguyên cho mọi tài khoản chưa set), BẬT = điểm Office.
    bonus_from_office: false,
};

/** Cờ cũ còn sót trong DB, coi như bí danh của cờ mới. */
const FLAG_ALIASES: Record<string, string[]> = {
    bonus_wallet: ['enable_bonus_wallet'],
    savings_wallet: ['enable_piggy_wallet'],
};

/**
 * Mọi khoá trong `Staff.feature_flags` mà bảng Tính năng của Admin quản lý —
 * gồm cả bí danh cũ.
 *
 * `feature_flags` là jsonb dùng chung: ngoài cờ tính năng, các màn khác còn
 * nhét trạng thái runtime vào đây (`is_on_call`, `travel_time_mins`,
 * `available_until`…). Khi cần ĐẶT LẠI bộ tính năng — đổi loại KTV chẳng hạn —
 * phải biết khoá nào là "của mình" để không quét sạch phần còn lại.
 */
export const MANAGED_FLAG_KEYS: string[] = [
    ...Object.keys(FLAG_DEFAULT_WHEN_MISSING),
    ...Object.values(FLAG_ALIASES).flat(),
];

/**
 * Đọc một cờ của nhân viên. `flags` có thể là object, chuỗi JSON, hoặc null.
 */
export function resolveStaffFlag(flags: any, key: string): boolean {
    const parsed = parseFlags(flags);
    const candidates = [key, ...(FLAG_ALIASES[key] || [])];

    for (const k of candidates) {
        const raw = parsed?.[k];
        if (raw === undefined || raw === null || raw === '') continue;
        if (typeof raw === 'boolean') return raw;
        return String(raw).replace(/"/g, '').toLowerCase() === 'true';
    }

    return FLAG_DEFAULT_WHEN_MISSING[key] ?? false;
}

function parseFlags(flags: any): Record<string, any> {
    if (!flags) return {};
    if (typeof flags === 'string') {
        try { return JSON.parse(flags) || {}; } catch { return {}; }
    }
    return flags as Record<string, any>;
}

// ---------------------------------------------------------------------------
// Ví: công tắc hai tầng
// ---------------------------------------------------------------------------

export type WalletType = 'TUA' | 'BONUS' | 'SAVINGS';

export const WALLET_TYPES: WalletType[] = ['TUA', 'BONUS', 'SAVINGS'];

/** Cờ per-nhân-viên tương ứng mỗi loại ví. */
export const WALLET_STAFF_FLAG: Record<WalletType, string> = {
    TUA: 'tua_wallet',
    BONUS: 'bonus_wallet',
    SAVINGS: 'savings_wallet',
};

export const WORK_TYPES = ['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'] as const;
export type WorkType = typeof WORK_TYPES[number];

/**
 * Khoá SystemConfigs của công tắc CẢ LOẠI, ví dụ
 * `ktv_wallet_tua_enabled_TYPE_D`.
 */
export function walletConfigKey(wallet: WalletType, workType: string): string {
    return `ktv_wallet_${wallet.toLowerCase()}_enabled_${workType}`;
}

/**
 * Công tắc cả loại. Thiếu khoá = BẬT — trước khi có tính năng này thì không
 * có tầng chặn nào, mặc định phải giữ nguyên hành vi cũ.
 */
export function isWalletEnabledForType(
    wallet: WalletType,
    workType: string,
    configs: Record<string, any> | null | undefined,
): boolean {
    const raw = configs?.[walletConfigKey(wallet, workType || 'TYPE_A')];
    if (raw === undefined || raw === null || raw === '') return true;
    if (typeof raw === 'boolean') return raw;
    return String(raw).replace(/"/g, '').toLowerCase() === 'true';
}

/**
 * Kết quả cuối cùng KTV có thấy ví hay không: **cả loại BẬT và người đó BẬT**.
 * Tắt ở tầng loại thì cả loại mất ví, không cần đụng từng người; tắt ở tầng
 * người thì chỉ người đó mất.
 */
export function isWalletEnabled(
    wallet: WalletType,
    staff: { work_type?: string | null; feature_flags?: any } | null | undefined,
    configs: Record<string, any> | null | undefined,
): boolean {
    if (!staff) return false;
    return (
        isWalletEnabledForType(wallet, staff.work_type || 'TYPE_A', configs) &&
        resolveStaffFlag(staff.feature_flags, WALLET_STAFF_FLAG[wallet])
    );
}

export const WALLET_DISABLED_MESSAGE: Record<WalletType, string> = {
    TUA: 'Ví tua của bạn hiện đang tắt. Vui lòng liên hệ quản lý.',
    BONUS: 'Ví bonus của bạn hiện đang tắt. Vui lòng liên hệ quản lý.',
    SAVINGS: 'Ví tích luỹ của bạn hiện đang tắt. Vui lòng liên hệ quản lý.',
};
