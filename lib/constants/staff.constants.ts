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

/**
 * Chế tài cho từng tình huống vắng mặt của KTV Loại D.
 *
 * `hours` chỉ là mặc định ban đầu — quản lý chỉnh ở Cài đặt → Loại D, ghi vào
 * `SystemConfigs.ktv_type_d_discipline_rules.CASES`. Hằng số ở đây là lưới an
 * toàn khi cấu hình trống hoặc hỏng.
 *
 * Bốn chế tài:
 *   · NONE            — bỏ qua, chỉ ghi log
 *   · DEDUCT          — chỉ trừ giờ, không bao giờ khoá
 *   · LOCK            — khoá thẳng, không trừ giờ
 *   · DEDUCT_OR_LOCK  — quỹ giờ đủ thì trừ; không đủ thì khoá và KHÔNG trừ
 *
 * Mặc định theo quy chế Phase 5.5 (plans/plan_type_d_bao_vang_bao_tre.md mục
 * 13–14) cộng quyết định 12/09: mọi lỗi vắng mặt đều quy ra giờ, khoá tài khoản
 * chỉ là chế tài cuối khi quỹ giờ không gánh nổi.
 */
export type TypeDDisciplineAction = 'NONE' | 'DEDUCT' | 'LOCK' | 'DEDUCT_OR_LOCK';

export type TypeDDisciplineCaseKey =
    | 'NO_REGISTRATION'
    | 'NO_SHOW_NO_NOTICE'
    | 'LATE_REPORTED_NO_SHOW'
    | 'ABSENT_REPORTED_NO_SHOW';

export const TYPE_D_DISCIPLINE_CASES: Record<
    TypeDDisciplineCaseKey,
    { action: TypeDDisciplineAction; hours: number; label: string; moTa: string }
> = {
    /**
     * ⚠️ Từng có thêm một luật "chưa đăng ký lịch cho NGÀY MỚI" chạy song song,
     * hỏi về ngày vừa sang thay vì ngày vừa qua. Đã bỏ hẳn 12/09: nó hỏi cùng
     * một chuyện với luật dưới đây, mà lại hỏi sớm hơn 24 tiếng — nên sau một
     * đêm, mọi người còn dùng được app đều đã có đăng ký, và luật dưới đây
     * không bao giờ chạy tới. Quy chế cũng chỉ xét ngày ĐÃ QUA.
     */
    NO_REGISTRATION: {
        action: 'DEDUCT_OR_LOCK', hours: 10,
        label: 'Không đăng ký gì và không đi làm',
        moTa: 'Chốt NGÀY VỪA QUA: cả ngày không có dòng đăng ký nào, mà cũng không điểm danh. Có đến làm thì chỉ là quên đăng ký → bỏ qua.',
    },
    NO_SHOW_NO_NOTICE: {
        action: 'DEDUCT_OR_LOCK', hours: 10,
        label: 'Đăng ký làm, không báo, không đến',
        moTa: 'Đã đăng ký đi làm nhưng hết ngày không điểm danh, và cũng không bấm Báo vắng hay Báo trễ lần nào.',
    },
    LATE_REPORTED_NO_SHOW: {
        action: 'DEDUCT_OR_LOCK', hours: 10,
        label: 'Báo trễ rồi vẫn không đến',
        moTa: 'Đã bấm Báo trễ và hẹn giờ mới, nhưng hết ngày vẫn không điểm danh lần nào.',
    },
    ABSENT_REPORTED_NO_SHOW: {
        action: 'DEDUCT', hours: 5,
        label: 'Báo vắng trước 07:00, không đến',
        moTa: 'Đã bấm Báo vắng đúng quy trình. Từ 07:00 trở đi hệ thống không cho báo vắng nữa, nên mọi phiếu báo vắng đều thuộc diện này.',
    },
};

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
