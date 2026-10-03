import type { EmployeeSkills } from '@/lib/types';
import { FeatureFlagsTypeA, FeatureFlagsTypeB, FeatureFlagsTypeD } from '../types/staff.types';

export const DEFAULT_KPI_TARGET_HOURS = 80;
export const DEFAULT_TRAVEL_MINUTES = 15;

export const WORK_TYPE_LABELS = {
    TYPE_A: 'Cơ bản',
    TYPE_B: 'Hợp tác',
    TYPE_C: 'Cộng tác viên',
    TYPE_D: 'Khoán'
};

/**
 * KTV ngoài KHÔNG có tài khoản (cộng tác viên vãng lai): mã `Staff` do bảng điều
 * phối tự sinh khi quầy thêm một tên mới (`EXT_xxxxxx`; `C_xxxxxx` là mẫu cũ).
 * Không đăng nhập, không điểm danh. Danh sách nhân sự Admin lọc chúng ra.
 *
 * 12/09/2026 từng tắt tự sinh (138 dòng rác) và chuyển 132 dòng sang `ĐÃ NGHỈ`;
 * 15/09/2026 mở lại có kiểm soát vì tiệm vẫn dùng KTV ngoài hằng ngày —
 * plans/plan_mo_lai_ktv_ngoai_khong_tai_khoan.md. Tài khoản loại C thật (`C001`…)
 * KHÔNG khớp mẫu này.
 */
export const PLACEHOLDER_STAFF_ID = /^(EXT|C_)/i;
export const isPlaceholderStaffId = (id: string | null | undefined): boolean =>
    PLACEHOLDER_STAFF_ID.test(String(id || ''));
export const isTypeCWorkType = (workType: string | null | undefined): boolean =>
    String(workType || '').toUpperCase() === 'TYPE_C';

// ── KTV ngoài không tài khoản: một nguồn luật tên cho ô chọn KTV và máy chủ ──

/**
 * Ô chọn KTV giữ tạm KTV ngoài CHƯA có dòng `Staff` dưới dạng `NEW_EXT:<TÊN>`;
 * `processDispatch` / `saveDraftDispatch` đổi thành mã `EXT_` thật lúc lưu.
 */
export const NEW_EXTERNAL_KTV_PREFIX = 'NEW_EXT:';
export const EXTERNAL_KTV_NAME_MAX = 60;

export const isNewExternalKtvToken = (id: string | null | undefined): boolean =>
    String(id || '').toUpperCase().startsWith(NEW_EXTERNAL_KTV_PREFIX);

/** Tên KTV ngoài như lưu: gộp khoảng trắng, IN HOA (dữ liệu cũ đều in hoa). */
export const normalizeExternalKtvName = (raw: string | null | undefined): string =>
    String(raw || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');

export const newExternalKtvToken = (name: string): string =>
    NEW_EXTERNAL_KTV_PREFIX + normalizeExternalKtvName(name);

export const externalNameOfToken = (token: string): string =>
    normalizeExternalKtvName(String(token || '').slice(NEW_EXTERNAL_KTV_PREFIX.length));

/** Khoá so khớp tên: bỏ dấu, Đ→D — "nguyen anh" và "NGUYÊN ANH" là một người. */
export const externalKtvNameKey = (raw: string | null | undefined): string =>
    normalizeExternalKtvName(raw).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Đ/g, 'D');

type StaffNameRow = { id: string; full_name?: string | null; status?: string | null };

/**
 * KTV ngoài (mã placeholder) cùng tên, so không dấu. Ưu tiên người `ĐANG LÀM`,
 * rồi mã nhỏ nhất — hai máy quầy cùng thêm một tên thì cùng chọn một dòng.
 */
export function findExternalKtvByName<T extends StaffNameRow>(name: string, staffs: T[]): T | null {
    const key = externalKtvNameKey(name);
    if (!key) return null;
    const hits = (staffs || []).filter(s => isPlaceholderStaffId(s.id) && externalKtvNameKey(s.full_name) === key);
    hits.sort((a, b) =>
        ((a.status === 'ĐANG LÀM' ? 0 : 1) - (b.status === 'ĐANG LÀM' ? 0 : 1))
        || String(a.id).localeCompare(String(b.id)));
    return hits[0] || null;
}

/**
 * Vì sao không thêm được KTV ngoài tên này (`null` = thêm được).
 * Tên ghép nhiều người ("LISA - LUNA") ĐƯỢC PHÉP — chốt 15/09/2026 "để nhanh hơn".
 * Trùng mã hoặc tên một KTV nhà còn làm → phải chọn đúng người đó.
 */
export function externalKtvNameProblem(name: string, staffs: StaffNameRow[]): string | null {
    const normalized = normalizeExternalKtvName(name);
    if (!normalized) return 'Chưa nhập tên KTV ngoài.';
    if (normalized.length > EXTERNAL_KTV_NAME_MAX) return `Tên KTV ngoài dài quá ${EXTERNAL_KTV_NAME_MAX} ký tự.`;
    if (isNewExternalKtvToken(normalized)) return 'Tên KTV ngoài không hợp lệ.';
    const key = externalKtvNameKey(normalized);
    const house = (staffs || []).find(s =>
        !isPlaceholderStaffId(s.id) && s.status !== 'ĐÃ NGHỈ'
        && (externalKtvNameKey(s.id) === key || externalKtvNameKey(s.full_name) === key));
    if (house) return `Trùng KTV nhà ${house.id} — chọn người đó, không thêm KTV ngoài.`;
    return null;
}

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
 *
 * Riêng lỗi KHÔNG ĐĂNG KÝ LỊCH thì khoá thẳng (quyết định 14/09,
 * plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md): đăng ký trước là nghĩa vụ.
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
    {
        action: TypeDDisciplineAction; hours: number; label: string; moTa: string;
        /** Ai quét, quét lúc nào — để đọc bảng là biết ngay, khỏi mò trong code. */
        quetBoi: string;
        quetLuc: string;
    }
> = {
    /**
     * Hai luật đăng ký đi thành cặp (quyết định 14/09):
     *
     *   · UNREGISTERED_NEXT_DAY — 00:00 mà NGÀY VỪA SANG chưa có dòng đăng ký
     *     → khoá. Không miễn người đang trong ca.
     *   · NO_REGISTRATION — NGÀY VỪA QUA không có dòng đăng ký → khoá, kể cả có
     *     đi làm. Sau lượt trên, chỉ còn người được quầy mở khoá giữa ngày mà
     *     vẫn không đăng ký rơi vào đây — quyết định là khoá tiếp.
     *
     * Ngày 12/09 từng bỏ luật thứ nhất vì "nuốt" luật thứ hai. Nay luật thứ hai
     * không còn là code chết: nó bắt đúng người vừa được mở khoá.
     */
    UNREGISTERED_NEXT_DAY: {
        action: 'LOCK', hours: 10,
        label: 'Chưa đăng ký lịch cho ngày mới',
        moTa: 'Lúc 00:00, ngày vừa sang chưa có dòng đăng ký nào (đi làm hoặc OFF). Không miễn người đang làm dở đơn.',
        quetBoi: 'Cron chốt sổ', quetLuc: '00:00 mỗi đêm',
    },
    NO_REGISTRATION: {
        action: 'LOCK', hours: 10,
        label: 'Ngày vừa qua không có đăng ký',
        moTa: 'Chốt NGÀY VỪA QUA: cả ngày không có dòng đăng ký nào, kể cả có đi làm. Thường là người được quầy mở khoá mà vẫn không đăng ký.',
        quetBoi: 'Cron chốt sổ', quetLuc: '00:00 mỗi đêm',
    },
    NO_SHOW_NO_NOTICE: {
        action: 'DEDUCT_OR_LOCK', hours: 10,
        label: 'Đăng ký làm, không báo, không đến',
        moTa: 'Đã đăng ký đi làm nhưng hết ngày không điểm danh, và cũng không bấm Báo vắng hay Báo trễ lần nào.',
        quetBoi: 'Cron chốt sổ', quetLuc: '00:00 mỗi đêm',
    },
    LATE_REPORTED_NO_SHOW: {
        action: 'DEDUCT_OR_LOCK', hours: 10,
        label: 'Báo trễ rồi vẫn không đến',
        moTa: 'Đã bấm Báo trễ và hẹn giờ mới, nhưng hết ngày vẫn không điểm danh lần nào.',
        quetBoi: 'Cron chốt sổ', quetLuc: '00:00 mỗi đêm',
    },
    ABSENT_REPORTED_NO_SHOW: {
        action: 'DEDUCT', hours: 5,
        label: 'Báo vắng trước 07:00, không đến',
        moTa: 'Đã bấm Báo vắng đúng quy trình. Từ 07:00 trở đi hệ thống không cho báo vắng nữa, nên mọi phiếu báo vắng đều thuộc diện này.',
        quetBoi: 'Cron chốt sổ', quetLuc: '00:00 mỗi đêm',
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
 * Riêng loại C (cộng tác viên) quầy gọi bằng TÊN — mã `C001` mới đặt chưa ai
 * quen, còn mã placeholder cũ (`EXT_G6AMZG…`) thì không ai đọc được.
 */
export function ktvDisplayLabel(
    workType: string | null | undefined,
    code: string,
    fullName?: string | null
): string {
    // KTV ngoài vừa thêm, chưa gửi đơn: hiện tên đã gõ.
    if (isNewExternalKtvToken(code)) return externalNameOfToken(code);
    if (isTypeCWorkType(workType)) {
        return fullName?.trim() || code;
    }
    return code;
}

/**
 * Kỹ năng chuyên môn — cột `Staff.skills` (jsonb, dạng `{ key: boolean }`).
 *
 * NGUỒN DUY NHẤT của danh sách kỹ năng và nhãn hiển thị. Form thêm nhân viên,
 * modal chi tiết, bảng danh sách Admin và KTV Hub đều import từ đây. Thêm kỹ
 * năng mới: thêm key vào `EmployeeSkills` (lib/types.ts) rồi điền nhãn ở đây —
 * TypeScript sẽ báo lỗi nếu thiếu nhãn. Thứ tự khai báo = thứ tự hiện trên lưới.
 */
export const SKILL_LABELS: Record<keyof EmployeeSkills, string> = {
    hairCut: 'Cắt Tóc',
    shampoo: 'Gội đầu',
    hairExtensionShampoo: 'Gội Tóc Nối',
    earCombo: 'Ráy Combo',
    earChuyen: 'Ráy Chuyên',
    machineShave: 'Cạo Máy',
    razorShave: 'Cạo Dao',
    facial: 'Facial',
    thaiBody: 'Body Thái',
    shiatsuBody: 'Body Shiatsu',
    oilBody: 'Body Dầu',
    hotStoneBody: 'Body Đá Nóng',
    scrubBody: 'Scrub Body',
    bodyMix: 'Body Mix',
    foot: 'Foot',
    heelScrub: 'Bào Gót',
    nailCombo: 'Nail Combo',
    nailChuyen: 'Nail Chuyên',
};

export const SKILL_KEYS = Object.keys(SKILL_LABELS) as (keyof EmployeeSkills)[];

/** Nhãn cho key đọc từ DB — key cũ không còn trong danh sách thì trả về chính key. */
export const getSkillLabel = (key: string): string =>
    (SKILL_LABELS as Record<string, string>)[key] ?? key;

/** Bộ kỹ năng trống — dùng khi tạo nhân viên mới. */
export const DEFAULT_SKILLS: EmployeeSkills = SKILL_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: false }),
    {} as EmployeeSkills
);

/**
 * Bộ kỹ năng DỰ PHÒNG khi `Staff.skills` trong DB rỗng: mặc định biết Gội đầu
 * và Body Dầu — giữ nguyên hành vi cũ của trang Nhân viên và KTV Hub.
 */
export const FALLBACK_SKILLS: EmployeeSkills = { ...DEFAULT_SKILLS, shampoo: true, oilBody: true };
