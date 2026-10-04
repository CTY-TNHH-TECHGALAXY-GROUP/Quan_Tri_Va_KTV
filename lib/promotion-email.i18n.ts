import type { PromotionEmailLang } from '@/lib/types/promotion';

// Copy for the e-voucher email (issue + expiry reminder), 5 languages.
// Language = customer's preferred language (promo_customer_language, same rule as CRM).

export interface PromotionEmailStrings {
    subjectIssue: (brand: string, campaign: string) => string;
    subjectReminder: (brand: string, days: number) => string;
    greeting: (name: string) => string;
    introIssue: string;
    introReminder: (date: string) => string;
    voucherCode: string;
    benefit: string;
    validity: string;
    validFromTo: (from: string, to: string) => string;
    usage: string;
    usageUnlimited: string;
    usageLimited: (n: number) => string;
    howToTitle: string;
    howTo: string[];
    qrAlt: string;
    freeMinutes: (n: number) => string;
    percentOff: (n: number) => string;
    fixedOff: (amount: string) => string;
    hotline: string;
    footer: string;
    viewVoucher: string;
    contactToApply: (brand: string) => string;
    voucherFor: string;
    conditions: string;
}

const vi: PromotionEmailStrings = {
    subjectIssue: (brand, campaign) => `${brand} — E-Voucher của bạn: ${campaign}`,
    subjectReminder: (brand, days) => `${brand} — E-Voucher của bạn sẽ hết hạn sau ${days} ngày`,
    greeting: name => `Xin chào ${name},`,
    introIssue: 'Cảm ơn bạn đã tin chọn chúng tôi. Bạn vừa nhận được một E-Voucher:',
    introReminder: date => `E-Voucher của bạn sẽ hết hạn vào ${date}. Hãy ghé spa để sử dụng trước khi hết hạn nhé:`,
    voucherCode: 'Mã voucher',
    benefit: 'Ưu đãi',
    validity: 'Hiệu lực',
    validFromTo: (from, to) => `${from} – ${to}`,
    usage: 'Số lần dùng',
    usageUnlimited: 'Không giới hạn (tối đa 1 lần mỗi đơn)',
    usageLimited: n => `${n} lần (tối đa 1 lần mỗi đơn)`,
    howToTitle: 'Cách sử dụng',
    howTo: ['Đưa mã QR bên dưới cho quầy lễ tân khi đến spa.', 'Lễ tân quét mã và áp dụng ưu đãi vào đơn của bạn.'],
    qrAlt: 'Mã QR E-Voucher',
    freeMinutes: n => `Tặng thêm ${n} phút`,
    percentOff: n => `Giảm ${n}%`,
    fixedOff: amount => `Giảm ${amount}`,
    hotline: 'Hotline',
    footer: 'Cần hỗ trợ? Bạn có thể trả lời email này, đội chăm sóc khách hàng sẽ phản hồi.',
    viewVoucher: 'Xem E-Voucher',
    contactToApply: brand => `Vui lòng liên hệ ${brand} để áp dụng.`,
    voucherFor: 'Dành cho',
    conditions: 'Điều kiện',
};

const en: PromotionEmailStrings = {
    subjectIssue: (brand, campaign) => `${brand} — Your E-Voucher: ${campaign}`,
    subjectReminder: (brand, days) => `${brand} — Your E-Voucher expires in ${days} days`,
    greeting: name => `Dear ${name},`,
    introIssue: 'Thank you for choosing us. You have received an E-Voucher:',
    introReminder: date => `Your E-Voucher expires on ${date}. Visit us and enjoy it before it expires:`,
    voucherCode: 'Voucher code',
    benefit: 'Benefit',
    validity: 'Valid',
    validFromTo: (from, to) => `${from} – ${to}`,
    usage: 'Uses',
    usageUnlimited: 'Unlimited (max once per order)',
    usageLimited: n => `${n} times (max once per order)`,
    howToTitle: 'How to use',
    howTo: ['Show the QR code below at the reception desk.', 'Our staff will scan it and apply the benefit to your order.'],
    qrAlt: 'E-Voucher QR code',
    freeMinutes: n => `+${n} free minutes`,
    percentOff: n => `${n}% off`,
    fixedOff: amount => `${amount} off`,
    hotline: 'Hotline',
    footer: 'Need help? Simply reply to this email and our customer care team will get back to you.',
    viewVoucher: 'View E-Voucher',
    contactToApply: brand => `Please contact ${brand} to apply this voucher.`,
    voucherFor: 'For',
    conditions: 'Conditions',
};

const cn: PromotionEmailStrings = {
    subjectIssue: (brand, campaign) => `${brand} — 您的电子优惠券：${campaign}`,
    subjectReminder: (brand, days) => `${brand} — 您的电子优惠券将在 ${days} 天后到期`,
    greeting: name => `${name}，您好：`,
    introIssue: '感谢您的信任与支持。您已获得一张电子优惠券：',
    introReminder: date => `您的电子优惠券将于 ${date} 到期，请在到期前来店使用：`,
    voucherCode: '优惠券代码',
    benefit: '优惠内容',
    validity: '有效期',
    validFromTo: (from, to) => `${from} – ${to}`,
    usage: '使用次数',
    usageUnlimited: '不限次数（每张订单限用 1 次）',
    usageLimited: n => `${n} 次（每张订单限用 1 次）`,
    howToTitle: '使用方法',
    howTo: ['到店时向前台出示下方二维码。', '前台扫码后将优惠应用到您的订单。'],
    qrAlt: '电子优惠券二维码',
    freeMinutes: n => `加赠 ${n} 分钟`,
    percentOff: n => `${n}% 折扣`,
    fixedOff: amount => `立减 ${amount}`,
    hotline: '热线',
    footer: '需要帮助？直接回复此邮件，我们的客服团队会尽快答复您。',
    viewVoucher: '查看电子优惠券',
    contactToApply: brand => `请联系 ${brand} 使用此优惠券。`,
    voucherFor: '适用于',
    conditions: '使用条件',
};

const jp: PromotionEmailStrings = {
    subjectIssue: (brand, campaign) => `${brand} — Eクーポンのお知らせ：${campaign}`,
    subjectReminder: (brand, days) => `${brand} — Eクーポンの有効期限まであと${days}日です`,
    greeting: name => `${name} 様`,
    introIssue: 'いつもご利用いただきありがとうございます。Eクーポンをお届けします：',
    introReminder: date => `Eクーポンの有効期限は ${date} です。期限内にぜひご利用ください：`,
    voucherCode: 'クーポンコード',
    benefit: '特典',
    validity: '有効期間',
    validFromTo: (from, to) => `${from} – ${to}`,
    usage: 'ご利用回数',
    usageUnlimited: '回数制限なし（1回のご注文につき1回まで）',
    usageLimited: n => `${n}回（1回のご注文につき1回まで）`,
    howToTitle: 'ご利用方法',
    howTo: ['ご来店時に下記のQRコードを受付にご提示ください。', 'スタッフがスキャンし、ご注文に特典を適用します。'],
    qrAlt: 'EクーポンQRコード',
    freeMinutes: n => `${n}分延長サービス`,
    percentOff: n => `${n}%割引`,
    fixedOff: amount => `${amount}割引`,
    hotline: 'ホットライン',
    footer: 'ご不明な点はこのメールにご返信ください。カスタマーケアより折り返しご連絡いたします。',
    viewVoucher: 'Eクーポンを見る',
    contactToApply: brand => `ご利用の際は ${brand} までお問い合わせください。`,
    voucherFor: 'ご利用者',
    conditions: 'ご利用条件',
};

const kr: PromotionEmailStrings = {
    subjectIssue: (brand, campaign) => `${brand} — 고객님의 E-바우처: ${campaign}`,
    subjectReminder: (brand, days) => `${brand} — E-바우처가 ${days}일 후 만료됩니다`,
    greeting: name => `${name} 고객님, 안녕하세요.`,
    introIssue: '저희 스파를 이용해 주셔서 감사합니다. E-바우처를 보내드립니다:',
    introReminder: date => `E-바우처가 ${date}에 만료됩니다. 만료 전에 꼭 사용해 주세요:`,
    voucherCode: '바우처 코드',
    benefit: '혜택',
    validity: '유효 기간',
    validFromTo: (from, to) => `${from} – ${to}`,
    usage: '사용 횟수',
    usageUnlimited: '무제한 (주문당 1회)',
    usageLimited: n => `${n}회 (주문당 1회)`,
    howToTitle: '사용 방법',
    howTo: ['방문 시 아래 QR 코드를 리셉션에 보여 주세요.', '직원이 스캔하여 주문에 혜택을 적용해 드립니다.'],
    qrAlt: 'E-바우처 QR 코드',
    freeMinutes: n => `${n}분 추가 무료`,
    percentOff: n => `${n}% 할인`,
    fixedOff: amount => `${amount} 할인`,
    hotline: '핫라인',
    footer: '도움이 필요하시면 이 메일에 회신해 주세요. 고객 지원팀이 답변드리겠습니다.',
    viewVoucher: 'E-바우처 보기',
    contactToApply: brand => `사용하시려면 ${brand}에 문의해 주세요.`,
    voucherFor: '대상',
    conditions: '사용 조건',
};

export const PROMOTION_EMAIL_I18N: Record<PromotionEmailLang, PromotionEmailStrings> = { vi, en, cn, jp, kr };
