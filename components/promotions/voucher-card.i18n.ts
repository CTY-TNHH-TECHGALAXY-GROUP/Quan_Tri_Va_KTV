import type { PromotionBenefit, PromotionEmailLang, PromotionPassEffectiveStatus, PromotionUsageRule } from '@/lib/types/promotion-client';

/**
 * Text printed ON the e-voucher card (VoucherCard3D), in the 5 customer
 * languages. The public /voucher page picks the language (Agent A:
 * `pickVoucherLang`); admin pages use `vi`.
 */
export interface VoucherCardLabels {
  eVoucher: string;
  complimentary: string;
  voucherCode: string;
  validUntil: string;
  statusLabel: string;
  forCustomer: string;
  template: string;
  untitled: string;
  qrOnIssue: string;
  qrInstruction: string;
  qrUnavailable: string;
  hintFront: string;
  hintBack: string;
  showFront: string;
  showBack: string;
  status: Record<PromotionPassEffectiveStatus, string>;
  benefit: (b: PromotionBenefit) => string;
  usage: (u: Pick<PromotionUsageRule, 'type' | 'limit' | 'maxPerOrder'>) => string;
}

const money = (locale: string, v: number) => `${new Intl.NumberFormat(locale).format(v)} VND`;

const benefitWith =
  (minutes: (n: number) => string, locale: string) =>
  (b: PromotionBenefit): string => {
    if (!(b.value > 0)) return '—';
    if (b.type === 'FREE_MINUTES') return minutes(b.value);
    if (b.type === 'PERCENT_DISCOUNT') return `-${b.value}%`;
    if (b.type === 'FIXED_DISCOUNT') return `-${money(locale, b.value)}`;
    return '—';
  };

export const VOUCHER_CARD_LABELS: Record<PromotionEmailLang, VoucherCardLabels> = {
  vi: {
    eVoucher: 'E-Voucher',
    complimentary: 'Ưu đãi miễn phí',
    voucherCode: 'Mã voucher',
    validUntil: 'Hiệu lực đến',
    statusLabel: 'Trạng thái',
    forCustomer: 'Tên khách',
    template: 'Mẫu e-voucher',
    untitled: 'Tên chương trình',
    qrOnIssue: 'QR được tạo khi phát voucher',
    qrInstruction: 'Đưa mã QR này cho nhân viên quét khi sử dụng ưu đãi.',
    qrUnavailable: 'Voucher không còn hiệu lực nên không hiển thị QR.',
    hintFront: 'Chạm vào thẻ để lật xem mã QR',
    hintBack: 'Chạm lần nữa để xem mặt trước',
    showFront: 'xem mặt trước',
    showBack: 'lật xem mã QR',
    status: { ACTIVE: 'Còn hiệu lực', NOT_STARTED: 'Chưa tới ngày', INACTIVE: 'Tạm dừng', EXPIRED: 'Hết hạn', USED_UP: 'Hết lượt', SUSPENDED: 'Tạm khoá', CANCELLED: 'Đã huỷ' },
    benefit: benefitWith((n) => `+${n} phút`, 'vi-VN'),
    usage: (u) => {
      const base = u.type === 'UNLIMITED' ? 'Không giới hạn' : u.type === 'ONE_TIME' ? 'Dùng 1 lần' : `Giới hạn ${u.limit ?? ''} lần`;
      return u.maxPerOrder > 1 ? `${base} · tối đa ${u.maxPerOrder}/đơn` : base;
    },
  },
  en: {
    eVoucher: 'E-Voucher',
    complimentary: 'Complimentary',
    voucherCode: 'Voucher code',
    validUntil: 'Valid until',
    statusLabel: 'Status',
    forCustomer: 'Guest name',
    template: 'Sample',
    untitled: 'Promotion name',
    qrOnIssue: 'QR is created when issued',
    qrInstruction: 'Show this QR code to our staff when using your voucher.',
    qrUnavailable: 'This voucher is no longer valid.',
    hintFront: 'Tap the card to show the QR code',
    hintBack: 'Tap again to see the front',
    showFront: 'show front',
    showBack: 'show QR code',
    status: { ACTIVE: 'Valid', NOT_STARTED: 'Not yet valid', INACTIVE: 'Paused', EXPIRED: 'Expired', USED_UP: 'Used up', SUSPENDED: 'Suspended', CANCELLED: 'Cancelled' },
    benefit: benefitWith((n) => `+${n} min`, 'en-US'),
    usage: (u) => {
      const base = u.type === 'UNLIMITED' ? 'Unlimited use' : u.type === 'ONE_TIME' ? 'One-time use' : `Up to ${u.limit ?? ''} uses`;
      return u.maxPerOrder > 1 ? `${base} · max ${u.maxPerOrder}/order` : base;
    },
  },
  cn: {
    eVoucher: '电子优惠券',
    complimentary: '免费礼遇',
    voucherCode: '券码',
    validUntil: '有效期至',
    statusLabel: '状态',
    forCustomer: '客户姓名',
    template: '样本',
    untitled: '活动名称',
    qrOnIssue: '发放时生成二维码',
    qrInstruction: '使用时请向工作人员出示此二维码。',
    qrUnavailable: '该优惠券已失效。',
    hintFront: '点击卡片查看二维码',
    hintBack: '再次点击查看正面',
    showFront: '查看正面',
    showBack: '查看二维码',
    status: { ACTIVE: '有效', NOT_STARTED: '尚未生效', INACTIVE: '已暂停', EXPIRED: '已过期', USED_UP: '已用完', SUSPENDED: '已冻结', CANCELLED: '已取消' },
    benefit: benefitWith((n) => `+${n} 分钟`, 'zh-CN'),
    usage: (u) => (u.type === 'UNLIMITED' ? '不限次数' : u.type === 'ONE_TIME' ? '限用一次' : `限 ${u.limit ?? ''} 次`),
  },
  jp: {
    eVoucher: 'Eクーポン',
    complimentary: '特典',
    voucherCode: 'クーポンコード',
    validUntil: '有効期限',
    statusLabel: 'ステータス',
    forCustomer: 'お名前',
    template: 'サンプル',
    untitled: 'キャンペーン名',
    qrOnIssue: '発行時にQRを作成',
    qrInstruction: 'ご利用時にこのQRコードをスタッフにお見せください。',
    qrUnavailable: 'このクーポンは無効です。',
    hintFront: 'カードをタップしてQRコードを表示',
    hintBack: 'もう一度タップで表面へ',
    showFront: '表面を表示',
    showBack: 'QRコードを表示',
    status: { ACTIVE: '有効', NOT_STARTED: '利用開始前', INACTIVE: '一時停止中', EXPIRED: '期限切れ', USED_UP: '利用回数終了', SUSPENDED: '利用停止', CANCELLED: '取消済み' },
    benefit: benefitWith((n) => `+${n} 分`, 'ja-JP'),
    usage: (u) => (u.type === 'UNLIMITED' ? '回数無制限' : u.type === 'ONE_TIME' ? '1回限り' : `${u.limit ?? ''} 回まで`),
  },
  kr: {
    eVoucher: 'E-바우처',
    complimentary: '무료 혜택',
    voucherCode: '바우처 코드',
    validUntil: '유효 기간',
    statusLabel: '상태',
    forCustomer: '고객명',
    template: '샘플',
    untitled: '프로모션명',
    qrOnIssue: '발급 시 QR 생성',
    qrInstruction: '사용 시 이 QR 코드를 직원에게 보여주세요.',
    qrUnavailable: '더 이상 유효하지 않은 바우처입니다.',
    hintFront: '카드를 탭하여 QR 코드 보기',
    hintBack: '다시 탭하여 앞면 보기',
    showFront: '앞면 보기',
    showBack: 'QR 코드 보기',
    status: { ACTIVE: '사용 가능', NOT_STARTED: '사용 시작 전', INACTIVE: '일시 중지', EXPIRED: '만료됨', USED_UP: '사용 완료', SUSPENDED: '사용 정지', CANCELLED: '취소됨' },
    benefit: benefitWith((n) => `+${n}분`, 'ko-KR'),
    usage: (u) => (u.type === 'UNLIMITED' ? '무제한' : u.type === 'ONE_TIME' ? '1회용' : `${u.limit ?? ''}회 한정`),
  },
};
