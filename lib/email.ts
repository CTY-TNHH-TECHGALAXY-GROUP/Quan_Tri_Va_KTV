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
  subject: string;
  greeting: (name: string) => string;
  intro: string;
  detailsTitle: string;
  lService: string;
  lDate: string;
  lTime: string;
  lDuration: string;
  lGuests: string;
  lTherapist: string;
  lBranch: string;
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
  arriveNote: (mins: number) => string;
  changeNote: (hours: number) => string;
  questions: (hotlineLink: string) => string;
  regards: string;
  teamName: (brand: string) => string;
}

const STRINGS: Record<string, Strings> = {
  vi: {
    locale: 'vi-VN',
    subject: 'Xác nhận đặt lịch',
    greeting: (name) => `Xin chào anh/chị ${name},`,
    intro: 'Cảm ơn quý khách đã tin tưởng và đặt lịch tại chúng tôi. Dưới đây là thông tin chi tiết về lịch hẹn của quý khách:',
    detailsTitle: 'CHI TIẾT LỊCH HẸN',
    lService: 'Dịch vụ', lDate: 'Ngày hẹn', lTime: 'Thời gian', lDuration: 'Thời lượng',
    lGuests: 'Số lượng khách', lTherapist: 'KTV yêu cầu', lBranch: 'Chi nhánh',
    lBookingId: 'Mã đơn', lTotal: 'Tổng tiền', lDeposit: 'Tiền đặt cọc',
    lPreferences: 'Yêu cầu điều trị', lFocus: 'Tập trung', lAvoid: 'Bỏ qua',
    lStrength: 'Lực massage', lNote: 'Ghi chú thêm',
    randomTherapist: 'Ngẫu nhiên',
    minsUnit: (n) => `${n} phút`,
    guestsUnit: (n) => `${n} khách`,
    depositTitle: 'XÁC NHẬN GIỮ CHỖ',
    depositIntro: (amount, hours) => `Để chính thức giữ chỗ và giúp chúng tôi chuẩn bị sẵn sàng phòng cũng như kỹ thuật viên phục vụ quý khách tốt nhất, quý khách vui lòng chuyển khoản đặt cọc <strong style="color:${C.gold};">${amount}</strong> trong vòng ${hours} tiếng tới.`,
    depositScan: 'Vui lòng quét mã QR phù hợp bên dưới để hoàn tất thanh toán:',
    qrIntl: 'Khách Quốc Tế',
    qrLocal: 'Khách Nội Địa (VietQR)',
    qrIntlNote: 'Dành cho ứng dụng ngân hàng quốc tế hỗ trợ QR.',
    qrLocalNote: 'Dành cho mọi ngân hàng Việt Nam qua Napas247.',
    depositImportant: (id) => `<strong>Lưu ý quan trọng:</strong> Để chúng tôi xác minh thanh toán ngay lập tức, vui lòng ghi rõ mã đơn <strong style="color:${C.gold};">${id}</strong> và tên của quý khách trong nội dung chuyển khoản.`,
    nextTitle: 'BƯỚC TIẾP THEO',
    nextNew: 'Ngay sau khi nhận được tiền đặt cọc, hệ thống sẽ tự động gửi email xác nhận chính thức kèm hướng dẫn khi đến spa.',
    nextReturning: 'Quý khách là khách hàng thân thiết nên <strong>không cần thanh toán trước</strong>. Quý khách có thể thanh toán trực tiếp tại quầy khi đến spa.',
    arriveNote: (mins) => `Để có trải nghiệm tốt nhất, quý khách vui lòng đến trước ${mins} phút.`,
    changeNote: (hours) => `Nếu cần đổi lịch hoặc hủy hẹn, quý khách vui lòng báo lại cho chúng tôi ít nhất ${hours} tiếng trước giờ hẹn bằng cách phản hồi trực tiếp email này.`,
    questions: (hotline) => `Mọi thắc mắc xin vui lòng liên hệ hotline ${hotline}.`,
    regards: 'Trân trọng,',
    teamName: (brand) => `Đội ngũ ${brand}`,
  },

  en: {
    locale: 'en-US',
    subject: 'Booking Confirmation',
    greeting: (name) => `Dear ${name},`,
    intro: 'Thank you for booking with us. Here are the details of your upcoming appointment:',
    detailsTitle: 'APPOINTMENT DETAILS',
    lService: 'Service', lDate: 'Date', lTime: 'Time', lDuration: 'Duration',
    lGuests: 'Guests', lTherapist: 'Requested therapist', lBranch: 'Branch',
    lBookingId: 'Booking ref.', lTotal: 'Total', lDeposit: 'Deposit',
    lPreferences: 'Treatment preferences', lFocus: 'Focus on', lAvoid: 'Avoid',
    lStrength: 'Pressure', lNote: 'Additional notes',
    randomTherapist: 'Any available',
    minsUnit: (n) => `${n} mins`,
    guestsUnit: (n) => `${n} guest(s)`,
    depositTitle: 'SECURING YOUR VISIT',
    depositIntro: (amount, hours) => `To officially secure your appointment and let us prepare your room and therapist, we kindly ask for a deposit of <strong style="color:${C.gold};">${amount}</strong> within the next ${hours} hours.`,
    depositScan: 'Please scan the appropriate QR code below to complete your payment:',
    qrIntl: 'International Guests',
    qrLocal: 'Local Guests (VietQR)',
    qrIntlNote: 'For international banking apps supporting QR payments.',
    qrLocalNote: 'For all Vietnamese banks via Napas247.',
    depositImportant: (id) => `<strong>Important:</strong> To help us verify your payment instantly, please include your booking reference <strong style="color:${C.gold};">${id}</strong> and your name in the transfer description.`,
    nextTitle: 'WHAT HAPPENS NEXT',
    nextNew: 'Once we receive your deposit, our system will automatically send you a final confirmation email with arrival instructions.',
    nextReturning: 'As a returning guest, <strong>no advance payment is required</strong>. You may simply pay at the counter upon arrival.',
    arriveNote: (mins) => `For the best experience, please arrive ${mins} minutes before your appointment.`,
    changeNote: (hours) => `If you need to reschedule or cancel, please let us know at least ${hours} hours in advance by replying directly to this email.`,
    questions: (hotline) => `For any questions, please contact our hotline ${hotline}.`,
    regards: 'Best regards,',
    teamName: (brand) => `The ${brand} Team`,
  },

  kr: {
    locale: 'ko-KR',
    subject: '예약 확인 안내',
    greeting: (name) => `${name} 고객님, 안녕하세요.`,
    intro: '저희를 예약해 주셔서 진심으로 감사드립니다. 예약하신 상세 내역은 다음과 같습니다:',
    detailsTitle: '예약 상세 내역',
    lService: '서비스', lDate: '예약 날짜', lTime: '시간', lDuration: '소요 시간',
    lGuests: '방문 인원', lTherapist: '지정 테라피스트', lBranch: '지점',
    lBookingId: '예약 번호', lTotal: '총 금액', lDeposit: '예약금',
    lPreferences: '관리 요청 사항', lFocus: '집중 부위', lAvoid: '제외 부위',
    lStrength: '마사지 강도', lNote: '추가 요청 사항',
    randomTherapist: '지정 없음',
    minsUnit: (n) => `${n}분`,
    guestsUnit: (n) => `${n}명`,
    depositTitle: '예약 확정 안내',
    depositIntro: (amount, hours) => `예약을 공식적으로 확정하고 전용 룸과 테라피스트를 미리 준비할 수 있도록, ${hours}시간 이내에 <strong style="color:${C.gold};">${amount}</strong>의 예약금 결제를 부탁드립니다.`,
    depositScan: '아래의 해당 QR 코드를 스캔하여 결제를 완료해 주세요:',
    qrIntl: '해외 고객',
    qrLocal: '베트남 국내 고객 (VietQR)',
    qrIntlNote: 'QR 결제를 지원하는 해외 은행 앱용.',
    qrLocalNote: 'Napas247을 통한 모든 베트남 은행용.',
    depositImportant: (id) => `<strong>유의 사항:</strong> 입금 확인을 빠르게 진행할 수 있도록, 송금 메모에 예약 번호 <strong style="color:${C.gold};">${id}</strong>와 고객님 성함을 입력해 주시기 바랍니다.`,
    nextTitle: '향후 진행 절차',
    nextNew: '예약금 확인이 완료되면 방문 안내가 포함된 최종 예약 확정 이메일을 자동으로 보내드립니다.',
    nextReturning: '기존 고객님이시므로 <strong>사전 결제가 필요하지 않습니다</strong>. 방문 시 카운터에서 결제해 주시면 됩니다.',
    arriveNote: (mins) => `최상의 서비스를 위해 예약 시간 ${mins}분 전까지 방문해 주시기 바랍니다.`,
    changeNote: (hours) => `예약 변경 또는 취소가 필요하신 경우, 예약 시간 최소 ${hours}시간 전까지 본 이메일에 회신하여 알려주시기 바랍니다.`,
    questions: (hotline) => `문의 사항은 고객센터 ${hotline}로 연락해 주세요.`,
    regards: '감사를 담아,',
    teamName: (brand) => `${brand} 팀 드림`,
  },

  jp: {
    locale: 'ja-JP',
    subject: 'ご予約確認のお知らせ',
    greeting: (name) => `${name} 様`,
    intro: 'この度はご予約いただき、誠にありがとうございます。ご予約の詳細は以下の通りです：',
    detailsTitle: 'ご予約内容',
    lService: 'メニュー', lDate: 'ご予約日', lTime: '時間', lDuration: '所要時間',
    lGuests: 'ご利用人数', lTherapist: 'ご指名', lBranch: '店舗',
    lBookingId: '予約番号', lTotal: '合計金額', lDeposit: '事前決済金',
    lPreferences: '施術のご要望', lFocus: '重点部位', lAvoid: '避ける部位',
    lStrength: '施術の強さ', lNote: 'その他ご要望',
    randomTherapist: '指名なし',
    minsUnit: (n) => `${n} 分`,
    guestsUnit: (n) => `${n} 名様`,
    depositTitle: 'ご予約確定について',
    depositIntro: (amount, hours) => `ご予約を正式に確定し、お部屋とセラピストを確実にご用意するため、${hours}時間以内に <strong style="color:${C.gold};">${amount}</strong> の事前決済金のお支払いをお願いいたします。`,
    depositScan: '以下の該当するQRコードをスキャンし、お支払いを完了させてください：',
    qrIntl: '海外のお客様',
    qrLocal: 'ベトナム国内のお客様（VietQR）',
    qrIntlNote: 'QR決済に対応した海外の銀行アプリ用。',
    qrLocalNote: 'Napas247 経由のすべてのベトナムの銀行用。',
    depositImportant: (id) => `<strong>重要なお願い：</strong> 入金確認をスムーズに行うため、お振込みの際は備考欄に予約番号 <strong style="color:${C.gold};">${id}</strong> とお客様のお名前をご入力ください。`,
    nextTitle: '今後の流れ',
    nextNew: 'ご入金が確認され次第、当日のご案内を記載した最終予約確定メールを自動でお送りいたします。',
    nextReturning: 'リピーターのお客様ですので、<strong>事前のお支払いは不要です</strong>。ご来店時にフロントでお支払いください。',
    arriveNote: (mins) => `最良のサービスをご提供するため、ご予約時間の${mins}分前までにお越しください。`,
    changeNote: (hours) => `ご予約の変更またはキャンセルの場合は、ご来店時間の${hours}時間前までに本メールへご返信ください。`,
    questions: (hotline) => `ご不明な点は ${hotline} までお問い合わせください。`,
    regards: 'よろしくお願い申し上げます。',
    teamName: (brand) => `${brand} スタッフ一同`,
  },

  cn: {
    locale: 'zh-CN',
    subject: '预约确认通知',
    greeting: (name) => `尊贵的 ${name}：`,
    intro: '感谢您的预订。以下是您本次预约的详细信息：',
    detailsTitle: '预约详情',
    lService: '服务项目', lDate: '预约日期', lTime: '时间', lDuration: '服务时长',
    lGuests: '到店人数', lTherapist: '指定理疗师', lBranch: '门店',
    lBookingId: '预约编号', lTotal: '总金额', lDeposit: '定金',
    lPreferences: '护理要求', lFocus: '重点部位', lAvoid: '避开部位',
    lStrength: '按摩力度', lNote: '其他备注',
    randomTherapist: '随机安排',
    minsUnit: (n) => `${n} 分钟`,
    guestsUnit: (n) => `${n} 人`,
    depositTitle: '确认您的预约',
    depositIntro: (amount, hours) => `为正式为您保留位置并提前准备房间和理疗师，请在 ${hours} 小时内支付 <strong style="color:${C.gold};">${amount}</strong> 的定金。`,
    depositScan: '请扫描下方对应的二维码完成支付：',
    qrIntl: '国际宾客',
    qrLocal: '本地宾客（VietQR）',
    qrIntlNote: '适用于支持二维码支付的国际银行应用。',
    qrLocalNote: '适用于通过 Napas247 的所有越南银行。',
    depositImportant: (id) => `<strong>重要提示：</strong> 为便于我们快速核对款项，请在转账备注中填写预约编号 <strong style="color:${C.gold};">${id}</strong> 及您的姓名。`,
    nextTitle: '接下来的流程',
    nextNew: '我们收到定金后，系统会自动向您发送最终确认邮件及到店指南。',
    nextReturning: '作为老客户，您<strong>无需提前付款</strong>，可在到店后于前台直接支付。',
    arriveNote: (mins) => `为获得最佳体验，请于预约时间前 ${mins} 分钟到店。`,
    changeNote: (hours) => `如需更改或取消预约，请至少提前 ${hours} 小时直接回复本邮件告知我们。`,
    questions: (hotline) => `如有任何疑问，欢迎联系热线 ${hotline}。`,
    regards: '顺祝商祺，',
    teamName: (brand) => `${brand} 团队`,
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

/** Khối "Yêu cầu điều trị" — chỉ render khi khách có chọn. */
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
      (l, i) => `
                    <div style="margin-bottom: ${i === lines.length - 1 ? '0' : '6px'};">
                      <span style="color: ${C.gold}; font-weight: 600; margin-right: 6px; font-size: 13px;">${escapeHtml(l.label)}:</span>
                      <span style="color: ${C.cream}; font-size: 13px;">${escapeHtml(l.value)}</span>
                    </div>`
    )
    .join('');

  return `
              <tr>
                <td colspan="2" style="padding: 12px 0 6px; border-top: 1px dashed rgba(247, 235, 199, 0.15);">
                  <div style="color: ${C.gold}; font-size: 13px; font-weight: 600; margin-bottom: 8px;">
                    • ${s.lPreferences}:
                  </div>
                  <div style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;">${rows}
                  </div>
                </td>
              </tr>`;
}

/** Khối "Ghi chú thêm" — chỉ render khi khách có nhập. */
function noteBlock(s: Strings, note?: string) {
  if (!note || !note.trim()) return '';
  return `
              <tr>
                <td colspan="2" style="padding: 12px 0 6px; border-top: 1px dashed rgba(247, 235, 199, 0.15);">
                  <div style="color: ${C.gold}; font-size: 13px; font-weight: 600; margin-bottom: 6px;">
                    • ${s.lNote}:
                  </div>
                  <div style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 8px; padding: 10px 14px; color: ${C.cream}; font-size: 13px; line-height: 1.6; white-space: pre-line; font-style: italic;">${escapeHtml(note.trim())}</div>
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

  const serviceNames = details.services?.length
    ? details.services.map(sv => escapeHtml(sv.name)).join('<br/>')
    : '—';

  const dateStr = details.date
    ? (() => {
        const d = new Date(details.date);
        return isNaN(d.getTime())
          ? escapeHtml(details.date)
          : d.toLocaleDateString(s.locale, { year: 'numeric', month: 'long', day: '2-digit' });
      })()
    : '—';

  const hotlineLink = `<a href="tel:${escapeHtml(cfg.email_hotline.replace(/\s/g, ''))}" style="color: ${C.gold}; text-decoration: none; font-weight: 600;">${escapeHtml(cfg.email_hotline)}</a>`;

  const rows = [
    detailRow(s.lService, serviceNames),
    detailRow(s.lDate, dateStr),
    detailRow(s.lTime, escapeHtml(details.time || '—'), { gold: true, bold: true }),
    detailRow(s.lDuration, details.duration ? s.minsUnit(details.duration) : '—'),
    detailRow(s.lGuests, s.guestsUnit(details.guests || 1)),
    detailRow(s.lTherapist, escapeHtml(details.therapist || s.randomTherapist)),
    detailRow(s.lBranch, escapeHtml(cfg.email_branch_name)),
    detailRow(s.lBookingId, escapeHtml(details.bookingId), { gold: true, bold: true }),
    details.totalAmount ? detailRow(s.lTotal, formatVND(details.totalAmount), { gold: true, bold: true }) : '',
    preferencesBlock(s, details.preferences),
    noteBlock(s, details.note),
  ].join('');

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(s.subject)} | ${escapeHtml(cfg.email_brand_name)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${C.pageBg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: ${C.cream};">

  <div style="background-color: ${C.pageBg}; padding: 32px 16px;">
    <!-- MAIN CONTAINER -->
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: ${C.cardBg}; border-radius: 18px; overflow: hidden; border: 1px solid ${C.border}; box-shadow: 0 10px 30px rgba(0,0,0,0.55);">

      <!-- BRAND HEADER -->
      <tr>
        <td align="center" style="padding: 28px 24px 20px; background: linear-gradient(180deg, #1f140f 0%, ${C.cardBg} 100%); border-bottom: 1px solid ${C.divider};">
          <a href="${escapeHtml(cfg.email_website_url)}" target="_blank" style="text-decoration: none; display: inline-block;">
            ${cfg.email_logo_url
              ? `<img src="${escapeHtml(cfg.email_logo_url)}" alt="${escapeHtml(cfg.email_brand_name)}" width="145" style="display: block; margin: 0 auto; max-width: 145px; width: 145px; height: auto; border: 0; outline: none; text-decoration: none;" />`
              : `<span style="display: inline-block; font-family: ${C.serif}; font-size: 26px; font-weight: 600; letter-spacing: 3px; color: ${C.gold};">${escapeHtml(cfg.email_brand_name)}</span>`}
          </a>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="padding: 32px 28px 28px;">
          <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${C.white};">
            ${escapeHtml(s.greeting(customerName))}
          </p>
          <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.7; color: ${C.creamBody};">
            ${s.intro}
          </p>

          <!-- DETAILS CARD -->
          <div style="background-color: ${C.innerBg}; border: 1px solid ${C.borderSoft}; border-radius: 14px; padding: 22px 24px; margin-bottom: 24px;">
            <div style="font-family: ${C.serif}; font-size: 15px; font-weight: 600; color: ${C.gold}; letter-spacing: 0.5px; margin-bottom: 16px;">
              ${s.detailsTitle}
            </div>

            <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.7;">${rows}
            </table>
          </div>

          ${SHOW_DEPOSIT_SECTION && isNewCustomer ? depositBlock(s, cfg, details, qrIntl, qrLocal) : ''}

          ${SHOW_DEPOSIT_SECTION ? `
          <!-- NEXT STEPS -->
          <div style="font-family: ${C.serif}; font-size: 14px; font-weight: 600; color: ${C.gold}; letter-spacing: 0.5px; margin-bottom: 10px;">
            ${s.nextTitle}
          </div>
          <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.7; color: ${C.creamBody};">
            ${isNewCustomer ? s.nextNew : s.nextReturning}
          </p>` : ''}

          <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.7; color: ${C.creamBody};">
            ${s.arriveNote(cfg.email_arrive_early_mins)} ${s.changeNote(cfg.email_cancel_notice_hours)}
          </p>

          <p style="margin: 0 0 28px; font-size: 14px; line-height: 1.7; color: ${C.creamBody};">
            ${s.questions(hotlineLink)}
          </p>

          <!-- SIGNOFF -->
          <div style="border-top: 1px solid ${C.divider}; padding-top: 20px;">
            <p style="margin: 0 0 4px; font-size: 14px; color: rgba(247, 235, 199, 0.8);">
              ${escapeHtml(s.regards)}
            </p>
            <p style="margin: 0; font-size: 15px; font-weight: 600; color: ${C.gold}; font-family: ${C.serif};">
              ${escapeHtml(s.teamName(cfg.email_brand_name))}
            </p>
          </div>

        </td>
      </tr>
    </table>
  </div>

</body>
</html>`;
}

/** Tiêu đề email theo ngôn ngữ + tên thương hiệu đang cấu hình. */
export function getBookingEmailSubject(cfg: EmailConfig, language: string, bookingId?: string) {
  const s = STRINGS[language] || STRINGS.vi;
  return `${s.subject} | ${cfg.email_brand_name}${bookingId ? ` · ${bookingId}` : ''}`;
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

    console.log('[EmailService] Confirmation email sent successfully to', toEmail, 'Message ID:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EmailService] Error sending confirmation email:', error);
    return { success: false, error };
  }
}

export { EMAIL_CONFIG_DEFAULTS };
