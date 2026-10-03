import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * THANG ĐÁNH GIÁ (4 hoặc 5 sao) — nguồn duy nhất
 * ================================================================
 * plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md
 *
 * Mỗi đánh giá lưu kèm thang lúc chấm (`rating_scale` trên Bookings / BookingItems /
 * BookingGuests, mặc định 4). Mọi chỗ diễn giải một số sao — % trừ tiền, "Xuất sắc",
 * đủ thưởng, nhãn chữ — phải đọc theo thang CỦA ĐÁNH GIÁ ĐÓ, không theo cấu hình hiện
 * tại. Đổi thang 4 → 5 vì vậy không làm đổi tiền/thưởng của đánh giá cũ (4/4 vẫn là
 * mức cao nhất), kể cả khi ledger Loại D tính lại ngày cũ.
 *
 * Không tự viết lại các quy tắc dưới đây ở màn hình hay route: gọi hàm ở file này.
 */

export type RatingScale = 4 | 5;
export const RATING_SCALES: readonly RatingScale[] = [4, 5];
export const DEFAULT_RATING_SCALE: RatingScale = 4;

export const RATING_LANGS = ['VN', 'EN', 'KR', 'JP', 'ZH'] as const;
export type RatingLang = typeof RATING_LANGS[number];
/** `internal` = chữ quầy / KTV thấy; các ngôn ngữ còn lại = chữ khách thấy trên kiosk. */
export type RatingLabelSet = { internal: string } & Record<RatingLang, string>;
export type RatingLabels = Record<RatingScale, Record<number, RatingLabelSet>>;
export type DeductionMap = Record<string, number>;

export const RATING_CONFIG_KEYS = {
    scale: 'customer_rating_scale',
    // Key cũ giữ nguyên nghĩa: bảng trừ Loại D của thang 4 (code cũ vẫn đọc được).
    typeD4: 'ktv_type_d_rating_deduction',
    // Công tắc khấu trừ theo sao. Tên KHÔNG chứa "enable": key có chữ đó bị
    // SessionEpochService coi là công tắc tính năng và đăng xuất mọi người khi lưu.
    typeDOn: 'ktv_type_d_rating_deduction_on',
    abcOn: 'ktv_abc_rating_deduction_on',
    typeD5: 'ktv_type_d_rating_deduction_5',
    abc4: 'ktv_abc_rating_deduction_4',
    abc5: 'ktv_abc_rating_deduction_5',
    labels: 'rating_labels',
} as const;

/** Bảng trừ mặc định (tỉ lệ 0–1). Khoá "0" = chưa đánh giá → không trừ. */
export const DEFAULT_TYPE_D_DEDUCTION: Record<RatingScale, DeductionMap> = {
    4: { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 },
    5: { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0, '5': 0 },
};
/** A/B/C chưa từng bị trừ theo sao — mặc định 0% cho tới khi admin nhập. */
export const DEFAULT_ABC_DEDUCTION: Record<RatingScale, DeductionMap> = {
    4: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 },
    5: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
};

const L = (internal: string, VN: string, EN: string, KR: string, JP: string, ZH: string): RatingLabelSet =>
    ({ internal, VN, EN, KR, JP, ZH });
/** Chữ mặc định = đúng chữ đang dùng trước khi có cấu hình (kiosk + lib/rating-label.ts). */
export const DEFAULT_RATING_LABELS: RatingLabels = {
    4: {
        1: L('Tệ', 'Tệ', 'Bad', '나쁨', '悪い', '差'),
        2: L('Bình thường', 'Bình thường', 'Ok', '보통', '普通', '一般'),
        3: L('Tốt', 'Tốt', 'Good', '좋음', '良い', '好'),
        4: L('Xuất sắc', 'Tuyệt vời', 'Excellent', '매우 좋음', '素晴らしい', '极好'),
    },
    // Thang 5 — theo "KTV Rating Scale Multilingual" (Oria Spa, 10/2026): tiếng Việt là bản gốc,
    // các ngôn ngữ khác dịch từ tiếng Anh; KR/JP mức 3 cố ý dịu hơn bản dịch sát nghĩa.
    5: {
        1: L('Cực kỳ tệ', 'Cực kỳ tệ', 'Very poor', '매우 나쁨', '非常に悪い', '非常差'),
        2: L('Thất vọng', 'Thất vọng', 'Disappointing', '실망스러움', '期待外れ', '令人失望'),
        3: L('Chưa ổn lắm', 'Chưa ổn lắm', 'Could be better', '아쉬움', 'もう少し', '有待改进'),
        4: L('Tuyệt vời', 'Tuyệt vời', 'Great', '훌륭함', '素晴らしい', '很好'),
        5: L('Xuất sắc', 'Xuất sắc', 'Excellent', '최고', '最高', '非常出色'),
    },
};

export type RatingConfig = {
    /** Thang cho đánh giá MỚI. */
    scale: RatingScale;
    /** Bảng ĐANG ÁP (công tắc tắt → toàn 0%). Mọi chỗ tính tiền dùng hai bảng này. */
    typeD: Record<RatingScale, DeductionMap>;
    abc: Record<RatingScale, DeductionMap>;
    /** Công tắc + bảng admin đã nhập (giữ nguyên khi tắt, để bật lại không phải nhập lại). */
    typeDOn: boolean;
    abcOn: boolean;
    typeDTables: Record<RatingScale, DeductionMap>;
    abcTables: Record<RatingScale, DeductionMap>;
    labels: RatingLabels;
};

const parseJson = (raw: unknown): any => {
    let value = raw;
    for (let i = 0; i < 2 && typeof value === 'string'; i++) {
        try { value = JSON.parse(value); } catch { return undefined; }
    }
    return value;
};

/** Thang của MỘT đánh giá: cột `rating_scale` của nó; thiếu/hỏng → 4 (mọi dữ liệu cũ). */
export function normalizeScale(raw: unknown): RatingScale {
    return Number(parseJson(raw)) === 5 ? 5 : 4;
}

/** Ghép bảng admin lưu lên bảng mặc định; bỏ giá trị không phải số 0–1. */
function mergeDeduction(defaults: DeductionMap, raw: unknown): DeductionMap {
    const saved = parseJson(raw);
    const out = { ...defaults };
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const key of Object.keys(defaults)) {
            const n = Number((saved as any)[key]);
            if ((saved as any)[key] !== undefined && Number.isFinite(n) && n >= 0 && n <= 1) out[key] = n;
        }
    }
    return out;
}

function mergeLabels(raw: unknown): RatingLabels {
    const saved = parseJson(raw) || {};
    const out = structuredClone(DEFAULT_RATING_LABELS);
    for (const scale of RATING_SCALES) for (const level of Object.keys(out[scale]).map(Number)) {
        const custom = saved?.[scale]?.[level];
        if (!custom || typeof custom !== 'object') continue;
        for (const key of ['internal', ...RATING_LANGS] as const) {
            const text = typeof custom[key] === 'string' ? custom[key].trim() : '';
            if (text) out[scale][level][key] = text.slice(0, 40);
        }
    }
    return out;
}

/** Dựng cấu hình từ các dòng SystemConfigs (dạng `{ key: value }`). Thiếu key nào dùng mặc định key đó. */
export function buildRatingConfig(configs: Record<string, unknown>): RatingConfig {
    const typeDTables = {
        4: mergeDeduction(DEFAULT_TYPE_D_DEDUCTION[4], configs[RATING_CONFIG_KEYS.typeD4]),
        5: mergeDeduction(DEFAULT_TYPE_D_DEDUCTION[5], configs[RATING_CONFIG_KEYS.typeD5]),
    };
    const abcTables = {
        4: mergeDeduction(DEFAULT_ABC_DEDUCTION[4], configs[RATING_CONFIG_KEYS.abc4]),
        5: mergeDeduction(DEFAULT_ABC_DEDUCTION[5], configs[RATING_CONFIG_KEYS.abc5]),
    };
    // Loại D trước giờ luôn trừ theo sao → thiếu key = BẬT. A/B/C chưa từng trừ → thiếu key = TẮT.
    const typeDOn = parseSwitch(configs[RATING_CONFIG_KEYS.typeDOn], true);
    const abcOn = parseSwitch(configs[RATING_CONFIG_KEYS.abcOn], false);
    return {
        scale: normalizeScale(configs[RATING_CONFIG_KEYS.scale]),
        typeD: typeDOn ? typeDTables : structuredClone(DEFAULT_ABC_DEDUCTION),
        abc: abcOn ? abcTables : structuredClone(DEFAULT_ABC_DEDUCTION),
        typeDOn, abcOn, typeDTables, abcTables,
        labels: mergeLabels(configs[RATING_CONFIG_KEYS.labels]),
    };
}

function parseSwitch(raw: unknown, fallback: boolean): boolean {
    const v = parseJson(raw);
    if (v === true || v === 'true' || v === 1) return true;
    if (v === false || v === 'false' || v === 0) return false;
    return fallback;
}

export async function loadRatingConfig(supabase: SupabaseClient): Promise<RatingConfig> {
    const { data } = await supabase.from('SystemConfigs').select('key, value')
        .in('key', Object.values(RATING_CONFIG_KEYS));
    return buildRatingConfig(Object.fromEntries((data || []).map((row: any) => [row.key, row.value])));
}

/**
 * Tỉ lệ trừ (0–1) của một mức sao. Chưa đánh giá / mức lạ → 0 (không trừ).
 * Tra ĐÚNG giá trị, không làm tròn — y như công thức trước đây (`map[String(rating)] ?? 0`).
 */
export function deductionRate(map: DeductionMap, rating: number | null | undefined): number {
    const n = Number(rating ?? 0);
    return n > 0 ? Number(map[String(n)] ?? 0) : 0;
}

/** Mức cao nhất của thang ("Xuất sắc"). */
export function isTopRating(rating: number | null | undefined, scale: RatingScale): boolean {
    // Không làm tròn: trước đây thưởng xét `rating >= 4` trên đúng giá trị.
    return Number(rating ?? 0) >= scale;
}

/** Đủ thưởng: chỉ mức cao nhất của thang (thang 4 → 4★ như trước, thang 5 → 5★). */
export function qualifiesForBonus(rating: number | null | undefined, scale: RatingScale): boolean {
    return isTopRating(rating, scale);
}

/** Đã chọn góp ý / vi phạm thì không được chấm mức cao nhất. */
export function maxRatingWithViolation(scale: RatingScale): number {
    return scale - 1;
}

/** Giữ trong khoảng 1..scale (đầu vào từ form). Trả null khi không phải số hợp lệ. */
export function clampRating(rating: unknown, scale: RatingScale): number | null {
    const n = Math.round(Number(rating));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(n, scale);
}

/** Nhãn chữ của một mức sao. Null khi chưa đánh giá. Mức vượt thang (dữ liệu lạ) → nhãn mức cao nhất. */
export function ratingLabelFor(rating: number | null | undefined, scale: RatingScale,
    labels: RatingLabels = DEFAULT_RATING_LABELS, lang: RatingLang | 'internal' = 'internal'): string | null {
    const n = Math.round(Number(rating ?? 0));
    if (n <= 0) return null;
    const set = labels[scale][Math.min(n, scale)];
    return set ? (set[lang] || set.internal) : null;
}

/** Validate a settings PATCH body for the rating keys it contains. Returns the error text, or null. */
export function ratingConfigPatchError(body: Record<string, unknown>): string | null {
    const scale = body[RATING_CONFIG_KEYS.scale];
    if (scale !== undefined && ![4, 5].includes(Number(scale))) return 'Thang đánh giá chỉ được 4 hoặc 5 sao.';
    for (const key of [RATING_CONFIG_KEYS.typeDOn, RATING_CONFIG_KEYS.abcOn])
        if (body[key] !== undefined && typeof body[key] !== 'boolean') return 'Công tắc khấu trừ phải là bật / tắt.';
    for (const key of [RATING_CONFIG_KEYS.typeD4, RATING_CONFIG_KEYS.typeD5, RATING_CONFIG_KEYS.abc4, RATING_CONFIG_KEYS.abc5]) {
        if (body[key] === undefined) continue;
        const map = parseJson(body[key]);
        if (!map || typeof map !== 'object' || Array.isArray(map)) return `Bảng khấu trừ ${key} không hợp lệ.`;
        for (const [star, value] of Object.entries(map)) {
            const n = Number(value);
            if (!/^[0-5]$/.test(star) || !Number.isFinite(n) || n < 0 || n > 1) return `Khấu trừ ${star} sao phải từ 0% đến 100%.`;
        }
    }
    const labels = body[RATING_CONFIG_KEYS.labels];
    if (labels !== undefined) {
        const parsed = parseJson(labels);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Nhãn đánh giá không hợp lệ.';
        for (const scaleKey of Object.keys(parsed)) for (const set of Object.values((parsed as any)[scaleKey] || {}))
            for (const text of Object.values(set as any)) if (typeof text !== 'string' || text.length > 40) return 'Mỗi nhãn tối đa 40 ký tự.';
    }
    return null;
}

/** Colour band of a rating inside its own scale (scale 4: 4 top · 3 good · 2 mid · 1 low, as before). */
export function ratingTone(rating: number | null | undefined, scale: RatingScale): 'top' | 'good' | 'mid' | 'low' {
    const n = Math.round(Number(rating ?? 0));
    return n >= scale ? 'top' : n >= scale - 1 ? 'good' : n >= 2 ? 'mid' : 'low';
}
