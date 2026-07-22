import nodemailer from 'nodemailer';

// Khởi tạo transporter từ biến môi trường
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Nội dung templates theo ngôn ngữ
// Mẹo: Sau này bạn muốn sửa nội dung, chỉ cần sửa các dòng chữ trong khối này là được.
export interface BookingDetails {
    bookingId: string;
    date: string;
    time: string;
    services: { name: string; duration: number }[];
    duration: number;
    guests: number;
    depositAmount: number;
}

const TEMPLATES = {
  vi: {
    subject: 'Yêu cầu đặt lịch của bạn tại Ngân Hà Spa',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => {
      const serviceHtml = details?.services?.map(s => `<li>- ${s.name} (${s.duration} phút)</li>`).join('') || '';
      const depositStr = details?.depositAmount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(details.depositAmount) : '...';
      const dateStr = details?.date ? new Date(details.date).toLocaleDateString('vi-VN') : '[Date]';
      const timeStr = details?.time || '[Time]';
      const bookId = details?.bookingId || '[Booking ID]';
      const guests = details?.guests || 1;

      return `
      <p>Thân gửi <strong>${name}</strong>,</p>
      <p>Cảm ơn bạn đã đặt lịch hẹn tại Ngân Hà Spa! Chúng tôi đã nhận được yêu cầu đặt chỗ của bạn và rất mong được sớm đón tiếp bạn.</p>
      <p>Dưới đây là thông tin chi tiết về lịch hẹn sắp tới của bạn:</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>Mã đặt chỗ:</strong> #${bookId}</li>
        <li><strong>Ngày & Giờ:</strong> ${dateStr} lúc ${timeStr}</li>
        <li><strong>Dịch vụ:</strong><br/>
           <ul style="list-style: none; padding-left: 10px; margin: 5px 0;">${serviceHtml}</ul>
        </li>
        <li><strong>Số lượng khách:</strong> ${guests}</li>
      </ul>
      
      ${isNewCustomer ? `
      <h3>💳 Xác nhận lịch hẹn</h3>
      <p>Để chính thức giữ chỗ và giúp chúng tôi chuẩn bị sẵn sàng phòng cũng như kỹ thuật viên phục vụ bạn tốt nhất, bạn vui lòng chuyển khoản đặt cọc <strong>${depositStr}</strong> trong vòng 2 tiếng tới.</p>
      <p>Vui lòng quét mã QR phù hợp bên dưới để hoàn tất thanh toán:</p>
      
      <table width="100%" style="margin-top: 20px; max-width: 600px;">
        <tr>
           <td width="50%" align="center"><strong>Khách Quốc Tế (Ứng dụng toàn cầu / Thẻ)</strong></td>
           <td width="50%" align="center"><strong>Khách Nội Địa (Ngân hàng Việt Nam / VietQR)</strong></td>
        </tr>
        <tr>
           <td align="center"><img src="${qr1}" alt="International QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
           <td align="center"><img src="${qr2}" alt="Vietnam QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
        </tr>
        <tr>
           <td align="center"><small>Dành cho các ứng dụng ngân hàng quốc tế có hỗ trợ thanh toán QR.</small></td>
           <td align="center"><small>Dành cho tất cả các ngân hàng Việt Nam qua Napas247 / VietQR.</small></td>
        </tr>
      </table>
      
      <p><strong>Lưu ý quan trọng:</strong> Để đội ngũ của chúng tôi có thể xác minh thanh toán ngay lập tức, vui lòng ghi rõ Mã đặt chỗ <strong>#${bookId}</strong> và Tên của bạn trong phần nội dung chuyển khoản.</p>
      
      <h3>Bước tiếp theo là gì?</h3>
      <p>Ngay sau khi nhận được tiền đặt cọc, hệ thống của chúng tôi sẽ tự động gửi email xác nhận chính thức kèm theo hướng dẫn khi đến spa.</p>
      ` : `
      <h3>Bước tiếp theo là gì?</h3>
      <p>Bạn là khách hàng đã từng sử dụng dịch vụ nên hệ thống <strong>không yêu cầu thanh toán trước</strong>. Bạn có thể thanh toán trực tiếp tại quầy khi đến spa.</p>
      `}
      
      <p>Bạn cần thay đổi kế hoạch? Nếu bạn cần đổi lịch hoặc hủy hẹn, vui lòng thông báo cho chúng tôi ít nhất 24 tiếng trước giờ hẹn bằng phản hồi trực tiếp qua email này.</p>
      <p>Nếu có bất kỳ thắc mắc nào, bạn cứ thoải mái liên hệ nhé. Hẹn gặp lại bạn sớm!</p>
      <p>Trân trọng,<br/><strong>Đội ngũ Ngân Hà Spa | +84 903014164 (Whatsapp/Zalo/Kakaotalk)</strong></p>
      `;
    },
  },
  en: {
    subject: 'Booking Confirmation - Ngân Hà Spa',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => {
      const serviceHtml = details?.services?.map(s => `<li>- ${s.name} (${s.duration} Minutes)</li>`).join('') || '';
      const depositStr = details?.depositAmount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(details.depositAmount) : '...';
      const dateStr = details?.date ? new Date(details.date).toLocaleDateString('en-US') : '[Date]';
      const timeStr = details?.time || '[Time]';
      const bookId = details?.bookingId || '[Booking ID]';
      const guests = details?.guests || 1;

      return `
      <p>Dear <strong>${name}</strong>,</p>
      <p>Thank you for booking with Ngân Hà Spa! We have received your reservation request, and we are looking forward to welcoming you soon.</p>
      <p>Here are the details of your upcoming visit:</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>Booking Reference:</strong> #${bookId}</li>
        <li><strong>Date & Time:</strong> ${dateStr} at ${timeStr}</li>
        <li><strong>Service(s):</strong><br/>
           <ul style="list-style: none; padding-left: 10px; margin: 5px 0;">${serviceHtml}</ul>
        </li>
        <li><strong>Guest(s):</strong> ${guests}</li>
      </ul>
      
      ${isNewCustomer ? `
      <h3>💳 Confirming Your Visit</h3>
      <p>To officially secure your appointment and help us prepare your room and therapist, we kindly ask for a deposit of <strong>${depositStr}</strong> within the next 2 hours.</p>
      <p>Please scan the appropriate QR code below to complete your payment:</p>
      
      <table width="100%" style="margin-top: 20px; max-width: 600px;">
        <tr>
           <td width="50%" align="center"><strong>International Guests (Global Apps / Cards)</strong></td>
           <td width="50%" align="center"><strong>Local Guests (Vietnam Banks / VietQR)</strong></td>
        </tr>
        <tr>
           <td align="center"><img src="${qr1}" alt="International QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
           <td align="center"><img src="${qr2}" alt="Vietnam QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
        </tr>
        <tr>
           <td align="center"><small>For international banking apps supporting QR payments.</small></td>
           <td align="center"><small>For all Vietnamese local banks via Napas247 / VietQR.</small></td>
        </tr>
      </table>
      
      <p><strong>Important Note:</strong> To help our team verify your payment instantly, please include your Booking Reference <strong>#${bookId}</strong> and Your Name in the transaction description.</p>
      
      <h3>What Happens Next?</h3>
      <p>Once we receive your deposit, our system will automatically send you a final confirmation email along with arrival instructions for your visit.</p>
      ` : `
      <h3>What Happens Next?</h3>
      <p>As a returning customer, <strong>no advance payment is required</strong>. You can simply pay at the counter upon arrival.</p>
      `}
      
      <p>Need to change your plans? If you need to reschedule or cancel your booking, please let us know at least 24 hours before your appointment by replying directly to this email.</p>
      <p>If you have any questions at all, feel free to reach out. See you soon!</p>
      <p>Best regards,<br/><strong>Ngân Hà Team | +84 903014164 (Whatsapp/Zalo/Kakaotalk)</strong></p>
      `;
    },
  },

  kr: {
    subject: 'Ngân Hà Spa 예약 신청 안내',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => {
      const serviceHtml = details?.services?.map(s => `<li>- ${s.name} (${s.duration}분)</li>`).join('') || '';
      const depositStr = details?.depositAmount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(details.depositAmount) : '...';
      const dateStr = details?.date ? new Date(details.date).toLocaleDateString('ko-KR') : '[Date]';
      const timeStr = details?.time || '[Time]';
      const bookId = details?.bookingId || '[Booking ID]';
      const guests = details?.guests || 1;

      return `
      <p><strong>${name}</strong> 고객님, 안녕하세요.</p>
      <p>Ngân Hà Spa를 예약해 주셔서 진심으로 감사드립니다! 고객님의 예약 신청이 정상적으로 접수되었으며, 곧 만나 뵙기를 기대하고 있습니다.</p>
      <p>예약하신 상세 내역은 다음과 같습니다:</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>예약 번호:</strong> #${bookId}</li>
        <li><strong>날짜 및 시간:</strong> ${dateStr} ${timeStr}</li>
        <li><strong>서비스 코스:</strong><br/>
           <ul style="list-style: none; padding-left: 10px; margin: 5px 0;">${serviceHtml}</ul>
        </li>
        <li><strong>방문 인원:</strong> ${guests}명</li>
      </ul>
      
      ${isNewCustomer ? `
      <h3>💳 예약 확정을 위한 안내</h3>
      <p>고객님의 예약을 공식적으로 확정하고, 전용 룸과 테라피스트를 미리 준비할 수 있도록 앞으로 2시간 이내에 <strong>${depositStr}</strong>의 예약금 결제를 부탁드립니다.</p>
      <p>아래의 QR 코드 중 해당하는 항목을 스캔하여 결제를 완료해 주세요:</p>
      
      <table width="100%" style="margin-top: 20px; max-width: 600px;">
        <tr>
           <td width="50%" align="center"><strong>해외 고객 (글로벌 앱 / 카드)</strong></td>
           <td width="50%" align="center"><strong>베트남 국내 고객 (베트남 은행 / VietQR)</strong></td>
        </tr>
        <tr>
           <td align="center"><img src="${qr1}" alt="International QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
           <td align="center"><img src="${qr2}" alt="Vietnam QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
        </tr>
        <tr>
           <td align="center"><small>QR 결제를 지원하는 해외 은행 앱용</small></td>
           <td align="center"><small>Napas247 / VietQR을 통한 모든 베트남 현지 은행용</small></td>
        </tr>
      </table>
      
      <p><strong>유의 사항:</strong> 결제 내역을 빠르게 확인하실 수 있도록, 송금 시 메모(받는 분 통장 표시 문구)에 예약 번호 <strong>#${bookId}</strong>와 고객님 성함을 반드시 입력해 주시기 바랍니다.</p>
      
      <h3>향후 진행 절차</h3>
      <p>예약금 확인이 완료되면, 저희 시스템에서 방문 안내 사항이 포함된 최종 예약 확정 이메일을 자동으로 발송해 드립니다.</p>
      ` : `
      <h3>향후 진행 절차</h3>
      <p>기존 고객님이시므로 <strong>사전 결제가 필요하지 않습니다</strong>. 방문 시 카운터에서 결제해 주시면 됩니다.</p>
      `}
      
      <p>일정이 변경되셨나요? 예약을 변경하거나 취소하셔야 하는 경우, 예약 시간 최소 24시간 전까지 본 이메일에 회신하여 저희에게 알려주시기 바랍니다.</p>
      <p>궁금하신 점이 있으시다면 언제든지 편하게 문의해 주세요. 곧 뵙겠습니다!</p>
      <p>감사를 담아,<br/><strong>Ngân Hà Spa 팀 | +84 903014164 (Whatsapp/Zalo/Kakaotalk)</strong></p>
      `;
    },
  },
  jp: {
    subject: '【Ngân Hà Spa】ご予約リクエストの受付',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => {
      const serviceHtml = details?.services?.map(s => `<li>- ${s.name}（${s.duration} 分）</li>`).join('') || '';
      const depositStr = details?.depositAmount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(details.depositAmount) : '...';
      const dateStr = details?.date ? new Date(details.date).toLocaleDateString('ja-JP') : '[Date]';
      const timeStr = details?.time || '[Time]';
      const bookId = details?.bookingId || '[Booking ID]';
      const guests = details?.guests || 1;

      return `
      <p><strong>${name}</strong> 様</p>
      <p>この度は Ngân Hà Spa をご予約いただき、誠にありがとうございます。ご予約リクエストを受け付けいたしました。お越しを心よりお待ちしております。</p>
      <p>ご予約の詳細は以下の通りです：</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>予約番号：</strong> #${bookId}</li>
        <li><strong>日時：</strong> ${dateStr} ${timeStr}</li>
        <li><strong>メニュー：</strong><br/>
           <ul style="list-style: none; padding-left: 10px; margin: 5px 0;">${serviceHtml}</ul>
        </li>
        <li><strong>ご利用人数：</strong> ${guests} 名様</li>
      </ul>
      
      ${isNewCustomer ? `
      <h3>💳 ご予約確定についての手続き</h3>
      <p>ご予約を正式に確定し、専用のお部屋とセラピストを確実にご用意するため、2時間以内に、事前決済金（デポジット）として <strong>${depositStr}</strong> のお支払いをお願いしております。</p>
      <p>以下の該当するQRコードをスキャンし、お支払いを完了させてください：</p>
      
      <table width="100%" style="margin-top: 20px; max-width: 600px;">
        <tr>
           <td width="50%" align="center"><strong>海外からお越しのお客様（グローバルアプリ / カード）</strong></td>
           <td width="50%" align="center"><strong>ベトナム国内のお客様（ベトナムの銀行 / VietQR）</strong></td>
        </tr>
        <tr>
           <td align="center"><img src="${qr1}" alt="International QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
           <td align="center"><img src="${qr2}" alt="Vietnam QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
        </tr>
        <tr>
           <td align="center"><small>QR決済に対応している海外の銀行アプリ用。</small></td>
           <td align="center"><small>Napas247 / VietQR を利用したすべてのベトナム現地銀行用。</small></td>
        </tr>
      </table>
      
      <p><strong>重要なお願い：</strong> 当店にてスムーズに入金確認を行うため、お振込みの際は名義人の欄（または備考欄）に 予約番号 <strong>#${bookId}</strong> と お客様のお名前 をご入力いただきますようお願いいたします。</p>
      
      <h3>今後の流れ</h3>
      <p>ご入金が確認され次第、当日のご案内を記載した「最終予約確定メール」をシステムより自動的にお送りいたします。</p>
      ` : `
      <h3>今後の流れ</h3>
      <p>リピーターのお客様ですので、<strong>事前のお支払いは不要です</strong>。ご来店時にフロントでお支払いください。</p>
      `}
      
      <p>ご予定を変更される場合： ご予約の変更またはキャンセルをされる場合は、お手数ですがご来店時間の 24 時間前までにこのメールに直接ご返信ください。</p>
      <p>ご不明な点がございましたら、いつでもお気軽にお問い合わせください。お会いできるのを楽しみにしております。</p>
      <p>よろしくお願い申し上げます。<br/><strong>Ngân Hà Spa スタッフ一同 | +84 903014164 (Whatsapp/Zalo/Kakaotalk)</strong></p>
      `;
    },
  },
  cn: {
    subject: '主题：您在 Ngân Hà Spa 的预约申请',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => {
      const serviceHtml = details?.services?.map(s => `<li>- ${s.name}（${s.duration} 分钟）</li>`).join('') || '';
      const depositStr = details?.depositAmount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(details.depositAmount) : '...';
      const dateStr = details?.date ? new Date(details.date).toLocaleDateString('zh-CN') : '[Date]';
      const timeStr = details?.time || '[Time]';
      const bookId = details?.bookingId || '[Booking ID]';
      const guests = details?.guests || 1;

      return `
      <p>尊贵的 <strong>${name}</strong>：</p>
      <p>感谢您预订 Ngân Hà Spa！我们已收到您的预约申请，非常期待您的光临。</p>
      <p>以下是您即将到店的行程详情：</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>预约编号：</strong> #${bookId}</li>
        <li><strong>日期与时间：</strong> ${dateStr} ${timeStr}</li>
        <li><strong>服务项目：</strong><br/>
           <ul style="list-style: none; padding-left: 10px; margin: 5px 0;">${serviceHtml}</ul>
        </li>
        <li><strong>到店人数：</strong> ${guests} 人</li>
      </ul>
      
      ${isNewCustomer ? `
      <h3>💳 确认您的行程</h3>
      <p>为了正式为您保留位置并方便我们提前准备房间和理疗师，请在接下来的 2 小时 内支付 <strong>${depositStr}</strong> 的定金。</p>
      <p>请扫描下方对应的二维码完成支付：</p>
      
      <table width="100%" style="margin-top: 20px; max-width: 600px;">
        <tr>
           <td width="50%" align="center"><strong>国际宾客（全球应用 / 银行卡）</strong></td>
           <td width="50%" align="center"><strong>本地宾客（越南银行 / VietQR）</strong></td>
        </tr>
        <tr>
           <td align="center"><img src="${qr1}" alt="International QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
           <td align="center"><img src="${qr2}" alt="Vietnam QR" width="200" height="200" style="margin-top:10px; border:1px solid #eee; border-radius:8px;"/></td>
        </tr>
        <tr>
           <td align="center"><small>适用于支持QR码支付的国际银行应用程序。</small></td>
           <td align="center"><small>适用于所有通过 Napas247 / VietQR 的越南本地银行。</small></td>
        </tr>
      </table>
      
      <p><strong>重要提示：</strong> 为协助我们的团队快速核对您的款项，请务必在转账备注/附言中填写您的 预约编号 <strong>#${bookId}</strong> 和 您的姓名。</p>
      
      <h3>接下来的流程是什么？</h3>
      <p>我们收到您的定金后，系统会自动向您发送一封最终确认邮件以及到店指南。</p>
      ` : `
      <h3>接下来的流程是什么？</h3>
      <p>作为老客户，您<strong>无需提前付款</strong>。您可以在到店后在前台直接支付。</p>
      `}
      
      <p>需要调整计划？ 如果您需要更改时间或取消预约，请至少在预约前 24 小时直接回复本封邮件告知我们。</p>
      <p>如有任何疑问，欢迎随时与我们联系。期待您的光临！</p>
      <p>顺祝商祺，<br/><strong>Ngân Hà Spa 团队 | +84 903014164 (Whatsapp/Zalo/Kakaotalk)</strong></p>
      `;
    },
  },
};

export async function sendBookingConfirmationEmail(
  toEmail: string,
  customerName: string,
  language: string = 'vi',
  isNewCustomer: boolean = true,
  bookingDetails?: BookingDetails
) {
  try {
    const langKey = (Object.keys(TEMPLATES).includes(language) ? language : 'vi') as keyof typeof TEMPLATES;
    const template = TEMPLATES[langKey];

    // Placeholder cho mã QR Quốc tế (Cần thay thế bằng link thật sau)
    const qrPlaceholder1 = 'cid:international-qr';
    
    // Tích hợp VietQR động cho mã QR Nội địa (MB Bank)
    let qrPlaceholder2 = 'https://placehold.co/200x200/png?text=Vietnam+QR';
    if (bookingDetails && bookingDetails.depositAmount && bookingDetails.bookingId) {
      const bankBin = '970422'; // MB Bank
      const accountNo = '8600289999';
      const accountName = encodeURIComponent('CTY TNHH TECHGALAXY GROUP');
      const amount = bookingDetails.depositAmount;
      const addInfo = encodeURIComponent(bookingDetails.bookingId);
      qrPlaceholder2 = `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName}`;
    }

    const htmlContent = template.content(customerName || 'Quý khách', isNewCustomer, qrPlaceholder1, qrPlaceholder2, bookingDetails);

    const attachments: any[] = [];
    if (isNewCustomer) {
      // Đính kèm hình ảnh QR Code Quốc tế vào email bằng base64 để tránh lỗi đường dẫn trên Vercel
      const { internationalQrBase64 } = require('./qr-base64');
      attachments.push({
        filename: 'international-qr.png',
        content: internationalQrBase64,
        encoding: 'base64',
        cid: 'international-qr'
      });
    }

    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
      replyTo: process.env.SMTP_REPLY_TO,
      to: toEmail,
      subject: template.subject,
      html: htmlContent,
      attachments: attachments
    });

    console.log('[EmailService] Confirmation email sent successfully to', toEmail, 'Message ID:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EmailService] Error sending confirmation email:', error);
    return { success: false, error };
  }
}
