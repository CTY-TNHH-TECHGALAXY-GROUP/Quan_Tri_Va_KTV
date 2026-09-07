import nodemailer from 'nodemailer';
import { EmailConfig, EMAIL_CONFIG_DEFAULTS, getEmailConfig } from './email-config';

// Khởi tạo transporter từ biến môi trường (thông tin đăng nhập SMTP không lưu trong DB)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface BookingPreferences {
  /** Vùng cơ thể muốn tập trung */
  focus?: string;
  /** Vùng cơ thể muốn bỏ qua */
  avoid?: string;
  /** Lực massage */
  strength?: string;
}

export interface BookingDetails {
  bookingId: string;
  date: string;
  time: string;
  services: { name: string; duration: number }[];
  duration: number;
  guests: number;
  depositAmount: number;
  /** Tổng tiền của đơn (nếu có sẽ hiện dòng "Tổng tiền") */
  totalAmount?: number;
  /** KTV khách yêu cầu; bỏ trống = Ngẫu nhiên */
  therapist?: string;
  /** Yêu cầu điều trị (tập trung / bỏ qua / lực) */
  preferences?: BookingPreferences;
  /** Ghi chú thêm của khách */
  note?: string;
}

// ============================================================================
// BẢNG MÀU THƯƠNG HIỆU (theo template Oria Spa)
// ============================================================================
const C = {
  pageBg: '#1a120e',
  cardBg: '#281b15',
  innerBg: '#1f1510',
  border: '#4a352a',
  borderSoft: '#473328',
  divider: '#422f25',
  gold: '#D4AF37',
  cream: '#f7ebc7',
  creamDim: 'rgba(247, 235, 199, 0.6)',
  creamBody: 'rgba(247, 235, 199, 0.9)',
  white: '#ffffff',
  serif: "'Playfair Display', Georgia, serif",
};

/**
 * Tạm TẮT khối đặt cọc + QR và mục "Bước tiếp theo" theo yêu cầu vận hành.
 * Đổi thành true để bật lại — toàn bộ nội dung 5 ngôn ngữ và hàm dựng khối
 * vẫn được giữ nguyên bên dưới, không cần viết lại.
 */
const SHOW_DEPOSIT_SECTION = false;

const escapeHtml = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatVND = (amount: number) =>
  new Intl.NumberFormat('vi-VN').format(amount) + '&nbsp;₫';

// ============================================================================
// NỘI DUNG THEO NGÔN NGỮ
// Mẹo: muốn sửa chữ trong email, chỉ cần sửa các dòng trong khối này.
// ============================================================================
interface Strings {
  locale: string;
  preheader: string;
  subject: (brand: string) => string;
  statusBadge: string;
  greeting: (name: string) => string;
  intro: (brand: string) => string;
  detailsTitle: string;
  lService: string;
  lDate: string;
  lTime: string;
  lDuration: string;
  lTherapist: string;
  lLocation: string;
  lGuests: string;
  lBookingId: string;
  lTotal: string;
  lDeposit: string;
  lPreferences: string;
  lFocus: string;
  lAvoid: string;
  lStrength: string;
  lNote: string;
  randomTherapist: string;
  minsUnit: (n: number) => string;
  guestsUnit: (n: number) => string;
  // --- Mục "Trước khi đến" ---
  beforeTitle: string;
  arriveLine: (mins: number) => string;
  graceLine: (mins: number, hotline: string) => string;
  policyLabel: string;
  policyLine: (hours: number, hotline: string) => string;
  // --- Liên hệ / đổi lịch ---
  manageLinkText: string;
  changeWithLink: (link: string) => string;
  changeNoLink: string;
  closing: string;
  regards: string;
  teamName: (brand: string) => string;
  rightsReserved: string;
  // --- Khối đặt cọc (đang TẮT qua SHOW_DEPOSIT_SECTION, giữ để bật lại) ---
  depositTitle: string;
  depositIntro: (amount: string, hours: number) => string;
  depositScan: string;
  qrIntl: string;
  qrLocal: string;
  qrIntlNote: string;
  qrLocalNote: string;
  depositImportant: (id: string) => string;
  nextTitle: string;
  nextNew: string;
  nextReturning: string;
}

const STRINGS: Record<string, Strings> = {
  vi: {
    locale: 'vi-VN',
    preheader: 'Lịch hẹn của bạn đã được xác nhận.',
    subject: (brand) => `Lịch hẹn của bạn tại ${brand} đã được xác nhận ✓`,
    statusBadge: '✓ Lịch hẹn đã được xác nhận',
    greeting: (name) => `Xin chào ${name},`,
    intro: (brand) => `Tin vui — lịch hẹn của bạn tại ${brand} đã được xác nhận. Dưới đây là thông tin lịch hẹn đã được sắp xếp cho bạn.`,
    detailsTitle: 'Chi tiết lịch hẹn',
    lService: 'Dịch vụ', lDate: 'Ngày hẹn', lTime: 'Giờ hẹn', lDuration: 'Thời lượng',
    lTherapist: 'Kỹ thuật viên', lLocation: 'Địa điểm', lGuests: 'Số lượng khách',
    lBookingId: 'Mã đặt lịch', lTotal: 'Tổng thanh toán dự kiến', lDeposit: 'Tiền đặt cọc',
    lPreferences: 'Yêu cầu & lưu ý trị liệu', lFocus: 'Tập trung', lAvoid: 'Tránh',
    lStrength: 'Lực', lNote: 'Ghi chú thêm',
    randomTherapist: 'Ngẫu nhiên',
    minsUnit: (n) => `${n} phút`,
    guestsUnit: (n) => `${n} khách`,
    beforeTitle: 'Trước khi đến',
    arriveLine: (mins) => `Quý khách vui lòng đến sớm <strong style="color:#ffffff;">${mins} phút</strong> để làm thủ tục và ổn định chỗ ngồi.`,
    graceLine: (mins, hotline) => `Chúng tôi giữ chỗ thêm ${mins} phút sau giờ hẹn — nếu quý khách đến trễ,<br/>vui lòng gọi ${hotline} để chúng tôi sắp xếp tốt nhất có thể.`,
    policyLabel: 'Chính sách đổi lịch & hủy hẹn:',
    policyLine: (hours, hotline) => `Kế hoạch có thể thay đổi, chúng tôi hoàn toàn thông cảm! Nếu cần hủy hoặc đổi lịch, quý khách vui lòng báo sớm nhất có thể để chúng tôi tìm khung giờ khác phù hợp. Trường hợp hủy trong vòng <strong style="color:#ffffff;">${hours} giờ</strong> trước giờ hẹn có thể phát sinh phí hủy và chúng tôi không đảm bảo hoàn lại toàn bộ. Để hủy hoặc đổi lịch, quý khách chỉ cần phản hồi email này hoặc gọi ${hotline} — báo càng sớm, chúng tôi càng linh hoạt.`,
    manageLinkText: 'Quản lý lịch hẹn',
    changeWithLink: (link) => `<strong style="color:#ffffff;">Cần thay đổi?</strong> ${link} hoặc phản hồi email này.`,
    changeNoLink: '<strong style="color:#ffffff;">Cần thay đổi?</strong> Quý khách chỉ cần phản hồi email này.',
    closing: 'Chúng tôi rất mong được đón tiếp quý khách.',
    regards: 'Thân mến,',
    teamName: (brand) => `Đội ngũ ${brand}`,
    rightsReserved: 'ALL RIGHTS RESERVED',
    depositTitle: 'XÁC NHẬN GIỮ CHỖ',
    depositIntro: (amount, hours) => `Để chính thức giữ chỗ, quý khách vui lòng chuyển khoản đặt cọc <strong style="color:${C.gold};">${amount}</strong> trong vòng ${hours} tiếng tới.`,
    depositScan: 'Vui lòng quét mã QR phù hợp bên dưới để hoàn tất thanh toán:',
    qrIntl: 'Khách Quốc Tế',
    qrLocal: 'Khách Nội Địa (VietQR)',
    qrIntlNote: 'Dành cho ứng dụng ngân hàng quốc tế hỗ trợ QR.',
    qrLocalNote: 'Dành cho mọi ngân hàng Việt Nam qua Napas247.',
    depositImportant: (id) => `<strong>Lưu ý quan trọng:</strong> Vui lòng ghi rõ mã đơn <strong style="color:${C.gold};">${id}</strong> và tên của quý khách trong nội dung chuyển khoản.`,
    nextTitle: 'BƯỚC TIẾP THEO',
    nextNew: 'Ngay sau khi nhận được tiền đặt cọc, hệ thống sẽ gửi email xác nhận chính thức.',
    nextReturning: 'Quý khách là khách hàng thân thiết nên <strong>không cần thanh toán trước</strong>.',
  },

  en: {
    locale: 'en-US',
    preheader: 'Your appointment has been confirmed.',
    subject: (brand) => `Your ${brand} appointment is confirmed ✓`,
    statusBadge: '✓ Appointment confirmed',
    greeting: (name) => `Hi ${name},`,
    intro: (brand) => `Great news — your appointment at ${brand} is confirmed. Here are the details we have arranged for you.`,
    detailsTitle: 'Booking details',
    lService: 'Service', lDate: 'Date', lTime: 'Time', lDuration: 'Duration',
    lTherapist: 'Therapist', lLocation: 'Location', lGuests: 'Guests',
    lBookingId: 'Booking ref.', lTotal: 'Estimated total', lDeposit: 'Deposit',
    lPreferences: 'Treatment preferences & notes', lFocus: 'Focus on', lAvoid: 'Avoid',
    lStrength: 'Pressure', lNote: 'Additional notes',
    randomTherapist: 'Random',
    minsUnit: (n) => `${n} mins`,
    guestsUnit: (n) => `${n} guest(s)`,
    beforeTitle: 'Before you arrive',
    arriveLine: (mins) => `Please arrive <strong style="color:#ffffff;">${mins} minutes early</strong> to check in and get settled.`,
    graceLine: (mins, hotline) => `We hold bookings for ${mins} minutes past the scheduled time — if you are running late, please call us at ${hotline} so we can do our best to accommodate you.`,
    policyLabel: 'Cancellation & Reschedule Policy:',
    policyLine: (hours, hotline) => `Plans change, and we understand! Please let us know as soon as possible if you need to cancel or reschedule. We will always do our best to find you a new time that works. Cancellations made less than <strong style="color:#ffffff;">${hours} hours</strong> before your appointment may be subject to a cancellation fee, and we cannot always guarantee a full refund. To cancel or reschedule, just reply to this email or call us at ${hotline} — the earlier you tell us, the more flexible we can be.`,
    manageLinkText: 'Manage your booking',
    changeWithLink: (link) => `<strong style="color:#ffffff;">Need to make changes?</strong> ${link} or reply to this email.`,
    changeNoLink: '<strong style="color:#ffffff;">Need to make changes?</strong> Reply to this email.',
    closing: `We can't wait to welcome you.`,
    regards: 'Warmly,',
    teamName: (brand) => `The ${brand} Team`,
    rightsReserved: 'ALL RIGHTS RESERVED',
    depositTitle: 'SECURING YOUR VISIT',
    depositIntro: (amount, hours) => `To secure your appointment, we kindly ask for a deposit of <strong style="color:${C.gold};">${amount}</strong> within the next ${hours} hours.`,
    depositScan: 'Please scan the appropriate QR code below to complete your payment:',
    qrIntl: 'International Guests',
    qrLocal: 'Local Guests (VietQR)',
    qrIntlNote: 'For international banking apps supporting QR payments.',
    qrLocalNote: 'For all Vietnamese banks via Napas247.',
    depositImportant: (id) => `<strong>Important:</strong> Please include your booking reference <strong style="color:${C.gold};">${id}</strong> and your name in the transfer description.`,
    nextTitle: 'WHAT HAPPENS NEXT',
    nextNew: 'Once we receive your deposit, we will send you a final confirmation email.',
    nextReturning: 'As a returning guest, <strong>no advance payment is required</strong>.',
  },

  kr: {
    locale: 'ko-KR',
    preheader: '예약이 확정되었습니다.',
    subject: (brand) => `${brand} 예약이 확정되었습니다 ✓`,
    statusBadge: '✓ 예약 확정',
    greeting: (name) => `${name} 고객님, 안녕하세요.`,
    intro: (brand) => `반가운 소식입니다 — ${brand} 예약이 확정되었습니다. 준비해 드린 예약 내용은 아래와 같습니다.`,
    detailsTitle: '예약 상세 내역',
    lService: '서비스', lDate: '예약 날짜', lTime: '예약 시간', lDuration: '소요 시간',
    lTherapist: '테라피스트', lLocation: '오시는 길', lGuests: '방문 인원',
    lBookingId: '예약 번호', lTotal: '예상 결제 금액', lDeposit: '예약금',
    lPreferences: '관리 요청 및 참고 사항', lFocus: '집중 부위', lAvoid: '제외 부위',
    lStrength: '강도', lNote: '추가 요청 사항',
    randomTherapist: '랜덤 배정',
    minsUnit: (n) => `${n}분`,
    guestsUnit: (n) => `${n}명`,
    beforeTitle: '방문 전 안내',
    arriveLine: (mins) => `체크인과 휴식을 위해 예약 시간 <strong style="color:#ffffff;">${mins}분 전</strong>까지 방문해 주세요.`,
    graceLine: (mins, hotline) => `예약 시간 이후 ${mins}분까지 자리를 유지해 드립니다. 늦으실 경우 ${hotline}로 미리 연락 주시면 최대한 도와드리겠습니다.`,
    policyLabel: '변경 및 취소 정책:',
    policyLine: (hours, hotline) => `일정은 언제든 바뀔 수 있습니다. 취소나 변경이 필요하시면 가능한 한 빨리 알려주시기 바랍니다. 최대한 다른 시간대를 찾아드리겠습니다. 예약 시간 <strong style="color:#ffffff;">${hours}시간</strong> 이내에 취소하실 경우 취소 수수료가 발생할 수 있으며 전액 환불이 어려울 수 있습니다. 취소 또는 변경은 본 이메일에 회신하시거나 ${hotline}로 연락 주세요 — 일찍 알려주실수록 유연하게 도와드릴 수 있습니다.`,
    manageLinkText: '예약 관리하기',
    changeWithLink: (link) => `<strong style="color:#ffffff;">변경이 필요하신가요?</strong> ${link} 또는 본 이메일에 회신해 주세요.`,
    changeNoLink: '<strong style="color:#ffffff;">변경이 필요하신가요?</strong> 본 이메일에 회신해 주세요.',
    closing: '곧 뵙게 되기를 기대하겠습니다.',
    regards: '감사합니다,',
    teamName: (brand) => `${brand} 팀 드림`,
    rightsReserved: 'ALL RIGHTS RESERVED',
    depositTitle: '예약 확정 안내',
    depositIntro: (amount, hours) => `예약 확정을 위해 ${hours}시간 이내에 <strong style="color:${C.gold};">${amount}</strong>의 예약금 결제를 부탁드립니다.`,
    depositScan: '아래의 해당 QR 코드를 스캔하여 결제를 완료해 주세요:',
    qrIntl: '해외 고객',
    qrLocal: '베트남 국내 고객 (VietQR)',
    qrIntlNote: 'QR 결제를 지원하는 해외 은행 앱용.',
    qrLocalNote: 'Napas247을 통한 모든 베트남 은행용.',
    depositImportant: (id) => `<strong>유의 사항:</strong> 송금 메모에 예약 번호 <strong style="color:${C.gold};">${id}</strong>와 고객님 성함을 입력해 주시기 바랍니다.`,
    nextTitle: '향후 진행 절차',
    nextNew: '예약금 확인이 완료되면 최종 예약 확정 이메일을 보내드립니다.',
    nextReturning: '기존 고객님이시므로 <strong>사전 결제가 필요하지 않습니다</strong>.',
  },

  jp: {
    locale: 'ja-JP',
    preheader: 'ご予約が確定いたしました。',
    subject: (brand) => `【${brand}】ご予約が確定しました ✓`,
    statusBadge: '✓ ご予約確定',
    greeting: (name) => `${name} 様`,
    intro: (brand) => `嬉しいお知らせです — ${brand} でのご予約が確定いたしました。ご用意した内容は以下の通りです。`,
    detailsTitle: 'ご予約内容',
    lService: 'メニュー', lDate: 'ご予約日', lTime: 'ご予約時間', lDuration: '所要時間',
    lTherapist: 'セラピスト', lLocation: '所在地', lGuests: 'ご利用人数',
    lBookingId: '予約番号', lTotal: 'お支払い予定額', lDeposit: '事前決済金',
    lPreferences: '施術のご要望・注意事項', lFocus: '重点部位', lAvoid: '避ける部位',
    lStrength: '強さ', lNote: 'その他ご要望',
    randomTherapist: 'ランダム',
    minsUnit: (n) => `${n} 分`,
    guestsUnit: (n) => `${n} 名様`,
    beforeTitle: 'ご来店前のご案内',
    arriveLine: (mins) => `受付とおくつろぎのため、ご予約時間の <strong style="color:#ffffff;">${mins}分前</strong> までにお越しください。`,
    graceLine: (mins, hotline) => `ご予約時間から${mins}分間はお席をお取りしております。遅れる場合は ${hotline} までご連絡いただければ、可能な限り対応いたします。`,
    policyLabel: '変更・キャンセルについて:',
    policyLine: (hours, hotline) => `ご予定が変わることもございます。キャンセルや変更が必要な場合は、できるだけお早めにお知らせください。別のお時間をご案内できるよう最善を尽くします。ご予約時間の <strong style="color:#ffffff;">${hours}時間</strong> を切ってからのキャンセルは、キャンセル料が発生する場合があり、全額のご返金をお約束できないことがございます。キャンセル・変更は本メールへのご返信、または ${hotline} までお電話ください。お早めのご連絡ほど柔軟に対応できます。`,
    manageLinkText: 'ご予約の確認・変更',
    changeWithLink: (link) => `<strong style="color:#ffffff;">ご変更が必要ですか？</strong> ${link} をご利用いただくか、本メールにご返信ください。`,
    changeNoLink: '<strong style="color:#ffffff;">ご変更が必要ですか？</strong> 本メールにご返信ください。',
    closing: 'お会いできるのを心よりお待ちしております。',
    regards: 'どうぞよろしくお願いいたします。',
    teamName: (brand) => `${brand} スタッフ一同`,
    rightsReserved: 'ALL RIGHTS RESERVED',
    depositTitle: 'ご予約確定について',
    depositIntro: (amount, hours) => `ご予約確定のため、${hours}時間以内に <strong style="color:${C.gold};">${amount}</strong> の事前決済金のお支払いをお願いいたします。`,
    depositScan: '以下の該当するQRコードをスキャンし、お支払いを完了させてください：',
    qrIntl: '海外のお客様',
    qrLocal: 'ベトナム国内のお客様（VietQR）',
    qrIntlNote: 'QR決済に対応した海外の銀行アプリ用。',
    qrLocalNote: 'Napas247 経由のすべてのベトナムの銀行用。',
    depositImportant: (id) => `<strong>重要なお願い：</strong> お振込みの際は備考欄に予約番号 <strong style="color:${C.gold};">${id}</strong> とお客様のお名前をご入力ください。`,
    nextTitle: '今後の流れ',
    nextNew: 'ご入金が確認され次第、最終予約確定メールをお送りいたします。',
    nextReturning: 'リピーターのお客様ですので、<strong>事前のお支払いは不要です</strong>。',
  },

  cn: {
    locale: 'zh-CN',
    preheader: '您的预约已确认。',
    subject: (brand) => `您的 ${brand} 预约已确认 ✓`,
    statusBadge: '✓ 预约已确认',
    greeting: (name) => `${name} 您好，`,
    intro: (brand) => `好消息 — 您在 ${brand} 的预约已确认。以下是我们为您安排的详细信息。`,
    detailsTitle: '预约详情',
    lService: '服务项目', lDate: '预约日期', lTime: '预约时间', lDuration: '服务时长',
    lTherapist: '理疗师', lLocation: '地址', lGuests: '到店人数',
    lBookingId: '预约编号', lTotal: '预计支付金额', lDeposit: '定金',
    lPreferences: '护理要求与备注', lFocus: '重点部位', lAvoid: '避开部位',
    lStrength: '力度', lNote: '其他备注',
    randomTherapist: '随机',
    minsUnit: (n) => `${n} 分钟`,
    guestsUnit: (n) => `${n} 人`,
    beforeTitle: '到店前须知',
    arriveLine: (mins) => `请提前 <strong style="color:#ffffff;">${mins} 分钟</strong> 到店办理登记并稍作休息。`,
    graceLine: (mins, hotline) => `预约时间后我们会为您保留 ${mins} 分钟。如果您会迟到，请致电 ${hotline}，我们将尽力为您安排。`,
    policyLabel: '改期与取消政策：',
    policyLine: (hours, hotline) => `计划难免有变，我们完全理解！如需取消或改期，请尽早告知，我们会尽力为您另寻合适时段。若在预约时间前 <strong style="color:#ffffff;">${hours} 小时</strong> 之内取消，可能产生取消费用，且无法保证全额退款。取消或改期只需回复本邮件，或致电 ${hotline} — 越早告知，我们越能灵活安排。`,
    manageLinkText: '管理我的预约',
    changeWithLink: (link) => `<strong style="color:#ffffff;">需要变更吗？</strong> 请使用 ${link}，或直接回复本邮件。`,
    changeNoLink: '<strong style="color:#ffffff;">需要变更吗？</strong> 请直接回复本邮件。',
    closing: '我们期待您的光临。',
    regards: '此致，',
    teamName: (brand) => `${brand} 团队`,
    rightsReserved: 'ALL RIGHTS RESERVED',
    depositTitle: '确认您的预约',
    depositIntro: (amount, hours) => `为确认您的预约，请在 ${hours} 小时内支付 <strong style="color:${C.gold};">${amount}</strong> 的定金。`,
    depositScan: '请扫描下方对应的二维码完成支付：',
    qrIntl: '国际宾客',
    qrLocal: '本地宾客（VietQR）',
    qrIntlNote: '适用于支持二维码支付的国际银行应用。',
    qrLocalNote: '适用于通过 Napas247 的所有越南银行。',
    depositImportant: (id) => `<strong>重要提示：</strong> 请在转账备注中填写预约编号 <strong style="color:${C.gold};">${id}</strong> 及您的姓名。`,
    nextTitle: '接下来的流程',
    nextNew: '我们收到定金后，将向您发送最终确认邮件。',
    nextReturning: '作为老客户，您<strong>无需提前付款</strong>。',
  },
};

// ============================================================================
// CÁC KHỐI HTML DÙNG CHUNG
// ============================================================================

/** Một dòng label / value trong card chi tiết lịch hẹn. */
function detailRow(label: string, value: string, opts: { gold?: boolean; bold?: boolean } = {}) {
  const valueColor = opts.gold ? C.gold : C.white;
  const weight = opts.bold ? 'bold' : '500';
  return `
              <tr>
                <td style="padding: 5px 0; color: ${C.creamDim}; width: 38%; min-width: 110px; vertical-align: top;">
                  • <strong>${label}:</strong>
                </td>
                <td style="padding: 5px 0; color: ${valueColor}; font-weight: ${weight}; vertical-align: top;">
                  ${value}
                </td>
              </tr>`;
}

/** Khối "Yêu cầu & lưu ý trị liệu" — chỉ render khi khách có chọn. */
function preferencesBlock(s: Strings, prefs?: BookingPreferences) {
  if (!prefs) return '';
  const lines = [
    prefs.focus && { label: s.lFocus, value: prefs.focus },
    prefs.avoid && { label: s.lAvoid, value: prefs.avoid },
    prefs.strength && { label: s.lStrength, value: prefs.strength },
  ].filter(Boolean) as { label: string; value: string }[];

  if (lines.length === 0) return '';

  const rows = lines
    .map(
      l => `
                      <div style="margin:2px 0;"><span style="color:rgba(247,235,199,0.65); font-weight:600;">${escapeHtml(l.label)}:</span> <span style="color:${C.white};">${escapeHtml(l.value)}</span></div>`
    )
    .join('');

  return `
              <tr>
                <td colspan="2" style="padding:14px 0 0; border-top:1px dashed rgba(247,235,199,0.15);">
                  <div style="color:${C.gold}; font-size:13px; font-weight:600; margin-bottom:9px;">${escapeHtml(s.lPreferences)}</div>
                  <div style="font-size:13px; line-height:1.65; color:${C.cream};">${rows}
                  </div>
                </td>
              </tr>`;
}

/** Khối "Ghi chú thêm" — chỉ render khi khách có nhập. */
function noteBlock(s: Strings, note?: string) {
  if (!note || !note.trim()) return '';
  return `
              <tr>
                <td colspan="2" style="padding:14px 0 0; border-top:1px dashed rgba(247,235,199,0.15);">
                  <div style="color:${C.gold}; font-size:13px; font-weight:600; margin-bottom:9px;">${escapeHtml(s.lNote)}</div>
                  <div style="font-size:13px; line-height:1.65; color:${C.cream}; white-space:pre-line; font-style:italic;">${escapeHtml(note.trim())}</div>
                </td>
              </tr>`;
}

/** Khối đặt cọc + 2 mã QR — chỉ render cho khách mới. */
function depositBlock(s: Strings, cfg: EmailConfig, details: BookingDetails, qrIntl: string, qrLocal: string) {
  const amountStr = formatVND(details.depositAmount);
  return `
          <div style="background-color: ${C.innerBg}; border: 1px solid ${C.borderSoft}; border-radius: 14px; padding: 22px 24px; margin-bottom: 24px;">
            <div style="font-family: ${C.serif}; font-size: 15px; font-weight: 600; color: ${C.gold}; letter-spacing: 0.5px; margin-bottom: 14px;">
              💳 ${s.depositTitle}
            </div>
            <p style="margin: 0 0 12px; font-size: 14px; line-height: 1.7; color: ${C.creamBody};">
              ${s.depositIntro(amountStr, cfg.email_deposit_deadline_hours)}
            </p>
            <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.7; color: ${C.creamBody};">
              ${s.depositScan}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
              <tr>
                <td width="50%" align="center" style="color: ${C.gold}; font-size: 12px; font-weight: 600; padding-bottom: 6px;">${s.qrIntl}</td>
                <td width="50%" align="center" style="color: ${C.gold}; font-size: 12px; font-weight: 600; padding-bottom: 6px;">${s.qrLocal}</td>
              </tr>
              <tr>
                <td align="center"><img src="${qrIntl}" alt="International QR" width="170" height="170" style="border: 1px solid rgba(212, 175, 55, 0.25); border-radius: 10px; background: #ffffff; padding: 6px;" /></td>
                <td align="center"><img src="${qrLocal}" alt="VietQR" width="170" height="170" style="border: 1px solid rgba(212, 175, 55, 0.25); border-radius: 10px; background: #ffffff; padding: 6px;" /></td>
              </tr>
              <tr>
                <td align="center" style="color: ${C.creamDim}; font-size: 11px; padding-top: 8px; line-height: 1.5;">${s.qrIntlNote}</td>
                <td align="center" style="color: ${C.creamDim}; font-size: 11px; padding-top: 8px; line-height: 1.5;">${s.qrLocalNote}</td>
              </tr>
            </table>

            <p style="margin: 16px 0 0; font-size: 13px; line-height: 1.7; color: ${C.creamBody};">
              ${s.depositImportant(escapeHtml(details.bookingId))}
            </p>
          </div>`;
}

/**
 * Dựng toàn bộ HTML email theo layout Oria Spa (table-based, inline CSS).
 * Được export để trang cấu hình có thể xem trước.
 */
export function renderBookingEmailHtml(
  cfg: EmailConfig,
  customerName: string,
  language: string,
  isNewCustomer: boolean,
  details: BookingDetails,
  qrIntl: string,
  qrLocal: string
): string {
  const s = STRINGS[language] || STRINGS.vi;
  const brand = cfg.email_brand_name;

  const serviceNames = details.services?.length
    ? details.services.map(sv => escapeHtml(sv.name)).join('<br/>')
    : '—';

  const dateStr = details.date
    ? (() => {
        const d = new Date(details.date);
        return isNaN(d.getTime())
          ? escapeHtml(details.date)
          : d.toLocaleDateString(s.locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
      })()
    : '—';

  const hotlineLink = `<a href="tel:${escapeHtml(cfg.email_hotline.replace(/\s/g, ''))}" style="color:${C.gold}; text-decoration:none; font-weight:600;">${escapeHtml(cfg.email_hotline)}</a>`;

  // Địa điểm 2 tầng: tên chi nhánh ở trên, địa chỉ nhỏ mờ bên dưới (chỉ khi có).
  const diaChi = (cfg.email_branch_address || '').trim();
  const locationValue = `${escapeHtml(cfg.email_branch_name || brand)}${
    diaChi
      ? `<div style="margin-top:2px; font-size:12px; line-height:1.5; color:rgba(247,235,199,0.55);">${escapeHtml(diaChi)}</div>`
      : ''
  }`;

  // Link "Quản lý lịch hẹn" chỉ hiện khi admin đã cấu hình URL.
  const manageUrl = (cfg.email_manage_booking_url || '').trim();
  const changeLine = manageUrl
    ? s.changeWithLink(`<a href="${escapeHtml(manageUrl)}" style="color:${C.gold}; text-decoration:none; font-weight:600;">${escapeHtml(s.manageLinkText)}</a>`)
    : s.changeNoLink;

  const rows = [
    detailRow(s.lService, serviceNames),
    detailRow(s.lDate, dateStr),
    detailRow(s.lTime, escapeHtml(details.time || '—'), { gold: true, bold: true }),
    detailRow(s.lDuration, details.duration ? s.minsUnit(details.duration) : '—'),
    detailRow(s.lTherapist, escapeHtml(details.therapist || s.randomTherapist)),
    detailRow(s.lLocation, locationValue),
    detailRow(s.lGuests, s.guestsUnit(details.guests || 1)),
    detailRow(s.lBookingId, escapeHtml(details.bookingId), { gold: true, bold: true }),
    details.totalAmount ? detailRow(s.lTotal, formatVND(details.totalAmount), { gold: true, bold: true }) : '',
    preferencesBlock(s, details.preferences),
    noteBlock(s, details.note),
  ].join('');

  const logoBlock = cfg.email_logo_url
    ? `<img src="${escapeHtml(cfg.email_logo_url)}" alt="${escapeHtml(brand)}" width="145" style="display:block; width:145px; max-width:145px; height:auto; margin:0 auto; border:0; outline:none; text-decoration:none;">`
    : `<span style="display:inline-block; font-family:${C.serif}; font-size:26px; font-weight:600; letter-spacing:3px; color:${C.gold};">${escapeHtml(brand)}</span>`;

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(s.subject(brand))}</title>
</head>
<body style="margin:0; padding:0; background-color:${C.pageBg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; color:${C.cream};">
  <!-- PREHEADER: dòng tóm tắt hiện ở danh sách hộp thư, không hiện trong nội dung -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; line-height:1px; font-size:1px;">
    ${escapeHtml(s.preheader)}
  </div>

  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; margin:0; padding:0; background-color:${C.pageBg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; background-color:${C.cardBg}; border:1px solid ${C.border}; border-radius:18px; overflow:hidden;">

          <!-- BRAND HEADER -->
          <tr>
            <td align="center" style="padding:28px 24px 20px; background-color:#1f140f; border-bottom:1px solid ${C.divider};">
              <a href="${escapeHtml(cfg.email_website_url)}" target="_blank" style="text-decoration:none; display:inline-block;">
                ${logoBlock}
              </a>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:32px 28px 30px;">

              <!-- CONFIRMED STATUS -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">
                <tr>
                  <td align="center" style="color:${C.gold}; font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">
                    ${escapeHtml(s.statusBadge)}
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 14px; font-size:16px; font-weight:600; color:${C.white};">
                ${escapeHtml(s.greeting(customerName))}
              </p>
              <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:${C.creamBody};">
                ${escapeHtml(s.intro(brand))}
              </p>

              <!-- BOOKING DETAILS -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; margin:0 0 24px; background-color:${C.innerBg}; border:1px solid ${C.borderSoft}; border-radius:14px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:${C.serif}; font-size:15px; font-weight:600; color:${C.gold}; letter-spacing:0.4px; margin-bottom:16px;">
                      ${escapeHtml(s.detailsTitle)}
                    </div>

                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; font-size:14px; line-height:1.7;">${rows}
                    </table>
                  </td>
                </tr>
              </table>

              ${SHOW_DEPOSIT_SECTION && isNewCustomer ? depositBlock(s, cfg, details, qrIntl, qrLocal) : ''}

              ${SHOW_DEPOSIT_SECTION ? `
              <div style="font-family:${C.serif}; font-size:14px; font-weight:600; color:${C.gold}; letter-spacing:0.5px; margin-bottom:10px;">
                ${s.nextTitle}
              </div>
              <p style="margin:0 0 16px; font-size:14px; line-height:1.7; color:${C.creamBody};">
                ${isNewCustomer ? s.nextNew : s.nextReturning}
              </p>` : ''}

              <!-- BEFORE ARRIVAL -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; margin:0 0 24px; border-top:1px solid ${C.divider}; border-bottom:1px solid ${C.divider};">
                <tr>
                  <td style="padding:20px 0;">
                    <div style="font-family:${C.serif}; font-size:15px; font-weight:600; color:${C.gold}; margin-bottom:12px;">${escapeHtml(s.beforeTitle)}</div>
                    <p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:${C.creamBody};">
                      ${s.arriveLine(cfg.email_arrive_early_mins)}
                    </p>
                    <p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:${C.creamBody};">
                      ${s.graceLine(cfg.email_grace_minutes, hotlineLink)}
                    </p>
                    <p style="margin:0; font-size:13px; line-height:1.7; color:rgba(247,235,199,0.75);">
                      <strong style="color:${C.cream};">${escapeHtml(s.policyLabel)}</strong> ${s.policyLine(cfg.email_cancel_notice_hours, hotlineLink)}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px; font-size:14px; line-height:1.7; color:${C.creamBody};">
                ${changeLine}
              </p>
              <p style="margin:0 0 28px; font-size:14px; line-height:1.7; color:${C.creamBody};">
                ${escapeHtml(s.closing)}
              </p>

              <!-- SIGNOFF -->
              <div style="border-top:1px solid ${C.divider}; padding-top:20px;">
                <p style="margin:0 0 4px; font-size:14px; color:rgba(247,235,199,0.8);">${escapeHtml(s.regards)}</p>
                <p style="margin:0; font-size:15px; font-weight:600; color:${C.gold}; font-family:${C.serif};">${escapeHtml(s.teamName(brand))}</p>
              </div>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding:20px; background-color:${C.pageBg}; border-top:1px solid #3d2b22; text-align:center;">
              <p style="margin:0; font-size:11px; letter-spacing:1px; color:rgba(247,235,199,0.35); text-transform:uppercase;">
                © ${new Date().getFullYear()} ${escapeHtml(cfg.email_company_name)} • ${escapeHtml(s.rightsReserved)}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Tiêu đề email theo ngôn ngữ, ví dụ: "Your ORIA SPA appointment is confirmed ✓".
 * bookingId được nối vào cuối để lễ tân tra cứu nhanh trong hộp thư.
 */
export function getBookingEmailSubject(cfg: EmailConfig, language: string, bookingId?: string) {
  const s = STRINGS[language] || STRINGS.vi;
  return `${s.subject(cfg.email_brand_name)}${bookingId ? ` · ${bookingId}` : ''}`;
}

/** Link ảnh VietQR động cho tài khoản nhận cọc đang cấu hình. */
export function buildVietQrUrl(cfg: EmailConfig, amount?: number, addInfo?: string) {
  const params = new URLSearchParams();
  if (amount) params.set('amount', String(amount));
  if (addInfo) params.set('addInfo', addInfo);
  params.set('accountName', cfg.email_bank_account_name);
  return `https://img.vietqr.io/image/${cfg.email_bank_bin}-${cfg.email_bank_account_no}-compact.png?${params.toString()}`;
}

// ============================================================================
// GỬI EMAIL
// ============================================================================
export async function sendBookingConfirmationEmail(
  toEmail: string,
  customerName: string,
  language: string = 'vi',
  isNewCustomer: boolean = true,
  bookingDetails?: BookingDetails,
  /** Bỏ qua công tắc bật/tắt — dùng cho nút "Gửi thử" ở trang cấu hình. */
  options?: { force?: boolean; config?: EmailConfig }
) {
  try {
    const cfg = options?.config ?? (await getEmailConfig());

    if (!cfg.enable_web_advance_booking_email && !options?.force) {
      console.log('[EmailService] Bỏ qua gửi email: công tắc gửi email đang TẮT.');
      return { success: false, skipped: true, error: 'Email đang bị tắt trong cấu hình hệ thống.' };
    }

    const langKey = STRINGS[language] ? language : 'vi';

    const details: BookingDetails = bookingDetails ?? {
      bookingId: '—', date: '', time: '', services: [], duration: 0, guests: 1, depositAmount: 0,
    };

    // QR quốc tế đính kèm dạng base64 (cid) để không phụ thuộc đường dẫn tĩnh trên Vercel
    const qrIntl = 'cid:international-qr';
    const qrLocal =
      details.depositAmount && details.bookingId
        ? buildVietQrUrl(cfg, details.depositAmount, details.bookingId)
        : 'https://placehold.co/200x200/png?text=VietQR';

    const htmlContent = renderBookingEmailHtml(
      cfg,
      customerName || 'Quý khách',
      langKey,
      isNewCustomer,
      details,
      qrIntl,
      qrLocal
    );

    const attachments: any[] = [];
    if (SHOW_DEPOSIT_SECTION && isNewCustomer) {
      const { internationalQrBase64 } = require('./qr-base64');
      attachments.push({
        filename: 'international-qr.png',
        content: internationalQrBase64,
        encoding: 'base64',
        cid: 'international-qr',
      });
    }

    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || cfg.email_brand_name}" <${process.env.SMTP_FROM_EMAIL}>`,
      replyTo: process.env.SMTP_REPLY_TO,
      to: toEmail,
      subject: getBookingEmailSubject(cfg, langKey, details.bookingId),
      html: htmlContent,
      attachments,
    });

    // Ghi lại phản hồi của máy chủ SMTP: khi khách báo "không thấy mail", đây là
    // bằng chứng phân biệt "chưa gửi được" với "đã gửi nhưng rơi vào Spam".
    console.log(
      '[EmailService] Đã gửi tới', toEmail,
      '| messageId:', info.messageId,
      '| accepted:', JSON.stringify(info.accepted),
      '| rejected:', JSON.stringify(info.rejected),
      '| response:', info.response
    );
    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    };
  } catch (error) {
    console.error('[EmailService] Error sending confirmation email:', error);
    return { success: false, error };
  }
}

export { EMAIL_CONFIG_DEFAULTS };
