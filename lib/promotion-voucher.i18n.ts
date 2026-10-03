import type { PromotionConditionsSummary, PromotionEmailLang } from '@/lib/types/promotion';

// Copy for the PUBLIC e-voucher page /voucher?t= (customer side), 5 languages.
// Language: ?lang= → Accept-Language → vi. UI belongs to the frontend (VoucherCard3D);
// this file only fixes the customer-facing wording so page and email say the same thing.

export const PROMOTION_VOUCHER_LANGS: PromotionEmailLang[] = ['vi', 'en', 'cn', 'jp', 'kr'];

export interface PromotionVoucherPageStrings {
    title: string;
    contactToApply: (brand: string) => string;
    invalidTitle: string;
    invalidBody: (brand: string) => string;
    status: Record<'ACTIVE' | 'NOT_STARTED' | 'INACTIVE' | 'EXPIRED' | 'USED_UP' | 'SUSPENDED' | 'CANCELLED', string>;
    validUntil: string;
    hotline: string;
    address: string;
    applicableMenus: string;
    allMenus: string;
}

export const PROMOTION_VOUCHER_PAGE_I18N: Record<PromotionEmailLang, PromotionVoucherPageStrings> = {
    vi: {
        title: 'E-Voucher của bạn',
        contactToApply: b => `Vui lòng liên hệ ${b} để áp dụng.`,
        invalidTitle: 'Voucher không hợp lệ',
        invalidBody: b => `Mã voucher không tồn tại hoặc đã bị huỷ. Vui lòng liên hệ ${b} để được hỗ trợ.`,
        status: { ACTIVE: 'Còn hiệu lực', NOT_STARTED: 'Chưa đến ngày áp dụng', INACTIVE: 'Tạm ngưng', EXPIRED: 'Đã hết hạn', USED_UP: 'Đã dùng hết lượt', SUSPENDED: 'Tạm khoá', CANCELLED: 'Đã huỷ' },
        validUntil: 'Hạn dùng', hotline: 'Hotline', address: 'Địa chỉ', applicableMenus: 'Áp dụng cho', allMenus: 'Tất cả menu',
    },
    en: {
        title: 'Your E-Voucher',
        contactToApply: b => `Please contact ${b} to apply this voucher.`,
        invalidTitle: 'Invalid voucher',
        invalidBody: b => `This voucher does not exist or has been cancelled. Please contact ${b} for help.`,
        status: { ACTIVE: 'Valid', NOT_STARTED: 'Not yet valid', INACTIVE: 'Paused', EXPIRED: 'Expired', USED_UP: 'Fully used', SUSPENDED: 'Suspended', CANCELLED: 'Cancelled' },
        validUntil: 'Valid until', hotline: 'Hotline', address: 'Address', applicableMenus: 'Applies to', allMenus: 'All menus',
    },
    cn: {
        title: '您的电子优惠券',
        contactToApply: b => `请联系 ${b} 使用此优惠券。`,
        invalidTitle: '优惠券无效',
        invalidBody: b => `该优惠券不存在或已被取消，请联系 ${b} 获取帮助。`,
        status: { ACTIVE: '有效', NOT_STARTED: '尚未生效', INACTIVE: '已暂停', EXPIRED: '已过期', USED_UP: '次数已用完', SUSPENDED: '已冻结', CANCELLED: '已取消' },
        validUntil: '有效期至', hotline: '热线', address: '地址', applicableMenus: '适用于', allMenus: '全部菜单',
    },
    jp: {
        title: 'あなたのEクーポン',
        contactToApply: b => `ご利用の際は ${b} までお問い合わせください。`,
        invalidTitle: '無効なクーポン',
        invalidBody: b => `このクーポンは存在しないか、取り消されています。${b} までお問い合わせください。`,
        status: { ACTIVE: '有効', NOT_STARTED: '利用開始前', INACTIVE: '一時停止中', EXPIRED: '期限切れ', USED_UP: '利用回数上限', SUSPENDED: '利用停止', CANCELLED: '取消済み' },
        validUntil: '有効期限', hotline: 'ホットライン', address: '住所', applicableMenus: '対象', allMenus: 'すべてのメニュー',
    },
    kr: {
        title: '나의 E-바우처',
        contactToApply: b => `사용하시려면 ${b}에 문의해 주세요.`,
        invalidTitle: '유효하지 않은 바우처',
        invalidBody: b => `존재하지 않거나 취소된 바우처입니다. ${b}에 문의해 주세요.`,
        status: { ACTIVE: '사용 가능', NOT_STARTED: '사용 시작 전', INACTIVE: '일시 중지', EXPIRED: '만료됨', USED_UP: '사용 횟수 소진', SUSPENDED: '사용 정지', CANCELLED: '취소됨' },
        validUntil: '유효 기간', hotline: '핫라인', address: '주소', applicableMenus: '적용 대상', allMenus: '전체 메뉴',
    },
};

/** ?lang= first, then the first supported Accept-Language tag, else vi. */
export function pickVoucherLang(langParam: string | null | undefined, acceptLanguage: string | null | undefined): PromotionEmailLang {
    const map: Record<string, PromotionEmailLang> = { vi: 'vi', vn: 'vi', en: 'en', zh: 'cn', cn: 'cn', ja: 'jp', jp: 'jp', ko: 'kr', kr: 'kr' };
    const fromParam = map[String(langParam || '').toLowerCase()];
    if (fromParam) return fromParam;
    for (const part of String(acceptLanguage || '').split(',')) {
        const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
        if (map[tag]) return map[tag];
    }
    return 'vi';
}

// ─── Conditions wording (one formatter for email + /voucher page) ───────────

const COND_I18N: Record<PromotionEmailLang, { fromMinutes: (n: number) => string; fromAmount: (a: string) => string; oneOf: string; and: string; or: string; anyService: string }> = {
    vi: { fromMinutes: n => `từ ${n} phút`, fromAmount: a => `đơn từ ${a}`, oneOf: 'một trong', and: ' và ', or: ' hoặc ', anyService: 'Mọi dịch vụ' },
    en: { fromMinutes: n => `${n} min or longer`, fromAmount: a => `order from ${a}`, oneOf: 'one of', and: ' and ', or: ' or ', anyService: 'Any service' },
    cn: { fromMinutes: n => `${n}分钟及以上`, fromAmount: a => `订单满 ${a}`, oneOf: '任选其一', and: '，并且', or: '，或', anyService: '任意项目' },
    jp: { fromMinutes: n => `${n}分以上`, fromAmount: a => `ご注文${a}以上`, oneOf: 'いずれか', and: '、かつ', or: '、または', anyService: 'すべてのメニュー' },
    kr: { fromMinutes: n => `${n}분 이상`, fromAmount: a => `주문 ${a} 이상`, oneOf: '중 하나', and: ' 그리고 ', or: ' 또는 ', anyService: '모든 서비스' },
};

const vnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;

/**
 * "Menu VIP · từ 90 phút", "Menu Standard · một trong (A, B) · từ 90 phút hoặc Menu Deep Body · từ 120 phút".
 * Returns [] when there are no conditions (= all services).
 */
export function formatPromotionConditions(summary: PromotionConditionsSummary | null | undefined, lang: PromotionEmailLang): string[] {
    const t = COND_I18N[lang] ?? COND_I18N.vi;
    if (!summary?.conditions?.length) return [];
    const parts = summary.conditions.map(c => {
        const bits: string[] = [];
        if (c.menus.length) bits.push(c.menus.join(' / '));
        if (c.categories.length) bits.push(c.categories.join(' / '));
        if (c.services.length) bits.push(c.services.length > 1 ? `${t.oneOf} (${c.services.join(', ')})` : c.services[0]);
        if (c.minMinutes) bits.push(t.fromMinutes(c.minMinutes));
        if (c.minOrderAmount != null) bits.push(t.fromAmount(vnd(c.minOrderAmount)));
        return bits.length ? bits.join(' · ') : t.anyService;
    });
    return summary.match === 'ANY' ? [parts.join(t.or)] : parts;
}
