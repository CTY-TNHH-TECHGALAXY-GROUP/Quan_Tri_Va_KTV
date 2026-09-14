import { FeatureFlagsTypeA, FeatureFlagsTypeB, FeatureFlagsTypeD } from '../types/staff.types';

export const DEFAULT_KPI_TARGET_HOURS = 80;
export const DEFAULT_TRAVEL_MINUTES = 15;

export const WORK_TYPE_LABELS = {
    TYPE_A: 'Cơ bản',
    TYPE_B: 'Hợp tác',
    TYPE_C: 'Nhập tay',
    TYPE_D: 'D'
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

export const DEFAULT_FEATURE_FLAGS_TYPE_D: FeatureFlagsTypeD = {
    laundry_deduction: true,
    sudden_leave_penalty: false,
    allow_on_call: false,
    enable_employee_tasks: false,
    bonus_wallet: true,
    savings_wallet: false,
    maintenance_fee: true,
    internal_fund_enabled: true,
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
    | 'UNREGISTERED_NEXT_DAY'
    | 'NO_REGISTRATION'
    | 'NO_SHOW_NO_NOTICE'
    | 'LATE_REPORTED_NO_SHOW'
    | 'ABSENT_REPORTED_NO_SHOW';

export const TYPE_D_DISCIPLINE_CASES: Record<
    TypeDDisciplineCaseKey,
    { action: TypeDDisciplineAction; hours: number; label: string; moTa: string }
> = {
    /**
     * ⚠️ Luật này KHÔNG có trong quy chế, nên mặc định TẮT.
     *
     * Quy chế chỉ xét ngày ĐÃ QUA: hết ngày mà không đăng ký gì và cũng không
     * đến làm thì mới phạt. Luật "nhìn tới trước" này do code tự thêm, và bật
     * nó lên thì nó nuốt luôn luật đúng: sau một đêm, mọi người còn dùng được
     * app đều đã có đăng ký cho ngày mới, nên `NO_REGISTRATION` không bao giờ
     * chạy tới — thành code chết.
     *
     * Muốn buộc KTV đăng ký trước thì bật ở Cài đặt → Loại D.
     */
    UNREGISTERED_NEXT_DAY: {
        action: 'NONE', hours: 0,
        label: 'Chưa đăng ký lịch cho ngày mới (ngoài quy chế)',
        moTa: 'Lúc 00:00 hỏi về NGÀY VỪA SANG: đã đăng ký đi làm hoặc OFF cho hôm nay chưa. Quy chế không có luật này nên mặc định bỏ qua — bật lên thì nó nuốt luôn luật ngay bên dưới.',
    },
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
