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
    subject: 'Xác nhận đặt lịch thành công - Ngan Ha Spa',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => `
      <p>Xin chào <strong>${name}</strong>,</p>
      <p>Cảm ơn bạn đã tin tưởng và đặt dịch vụ tại Ngan Ha Spa.</p>
      <p>Chúng tôi xin thông báo đã nhận được đơn đặt lịch của bạn thành công.</p>
      
      ${isNewCustomer ? `
      <p>Để tiến hành thanh toán, bạn vui lòng quét 1 trong 2 mã QR dưới đây:</p>
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr1}" alt="QR Code 1" width="200" height="200" />
        </div>
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr2}" alt="QR Code 2" width="200" height="200" />
        </div>
      </div>
      ` : `
      <p>Bạn là khách hàng đã từng sử dụng dịch vụ nên hệ thống <strong>không yêu cầu thanh toán trước</strong>. Bạn có thể thanh toán trực tiếp tại quầy khi đến spa.</p>
      `}
      
      <p style="margin-top: 20px;">Nếu bạn có bất kỳ câu hỏi nào hoặc cần thay đổi lịch hẹn, vui lòng trả lời trực tiếp email này. Đội ngũ CSKH của chúng tôi luôn sẵn sàng hỗ trợ bạn.</p>
      <p>Trân trọng,<br><strong>${process.env.SMTP_FROM_NAME}</strong></p>
    `,
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
      <p>Dear <strong>${name}</strong>,</p>
      <p>Thank you for choosing Ngan Ha Spa.</p>
      <p>We are pleased to inform you that we have successfully received your booking.</p>
      
      ${isNewCustomer ? `
      <p>For your convenience, you can complete the payment by scanning one of the two QR codes below:</p>
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr1}" alt="QR Code 1" width="200" height="200" />
        </div>
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr2}" alt="QR Code 2" width="200" height="200" />
        </div>
      </div>
      ` : `
      <p>As a returning customer, <strong>no advance payment is required</strong>. You can simply pay at the counter upon arrival.</p>
      `}
      
      <p style="margin-top: 20px;">If you have any questions or need to reschedule, please feel free to reply directly to this email. Our customer support team is always here to help.</p>
      <p>Best regards,<br><strong>${process.env.SMTP_FROM_NAME}</strong></p>
    `,
  },
  kr: {
    subject: '예약 확인 - Ngan Ha Spa',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => `
      <p>안녕하세요 <strong>${name}</strong>님,</p>
      <p>Ngan Ha Spa를 이용해 주셔서 진심으로 감사드립니다.</p>
      <p>고객님의 예약이 성공적으로 접수되었음을 알려드립니다.</p>
      
      ${isNewCustomer ? `
      <p>결제를 진행하시려면 아래의 두 QR 코드 중 하나를 스캔해 주십시오:</p>
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr1}" alt="QR Code 1" width="200" height="200" />
        </div>
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr2}" alt="QR Code 2" width="200" height="200" />
        </div>
      </div>
      ` : `
      <p>기존 고객님이시므로 <strong>사전 결제가 필요하지 않습니다</strong>. 방문 시 카운터에서 결제해 주시면 됩니다.</p>
      `}
      
      <p style="margin-top: 20px;">궁금한 점이 있으시거나 예약을 변경해야 하는 경우 이 이메일로 직접 회신해 주시기 바랍니다. 저희 고객 지원팀이 항상 도와드리겠습니다.</p>
      <p>감사합니다.<br><strong>${process.env.SMTP_FROM_NAME}</strong></p>
    `,
  },
  jp: {
    subject: 'ご予約の確認 - Ngan Ha Spa',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => `
      <p><strong>${name}</strong> 様</p>
      <p>Ngan Ha Spaをご利用いただき、誠にありがとうございます。</p>
      <p>ご予約を無事に承りましたことをお知らせいたします。</p>
      
      ${isNewCustomer ? `
      <p>お支払いにつきましては、以下の2つのQRコードのいずれかをスキャンして完了してください。</p>
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr1}" alt="QR Code 1" width="200" height="200" />
        </div>
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr2}" alt="QR Code 2" width="200" height="200" />
        </div>
      </div>
      ` : `
      <p>リピーターのお客様ですので、<strong>事前のお支払いは不要です</strong>。ご来店時にフロントでお支払いください。</p>
      `}
      
      <p style="margin-top: 20px;">ご不明な点がある場合、または予約の変更が必要な場合は、このメールに直接ご返信ください。カスタマーサポートチームがいつでもお手伝いいたします。</p>
      <p>よろしくお願いいたします。<br><strong>${process.env.SMTP_FROM_NAME}</strong></p>
    `,
  },
  cn: {
    subject: '预约确认 - Ngan Ha Spa',
    content: (name: string, isNewCustomer: boolean, qr1: string, qr2: string, details?: BookingDetails) => `
      <p>尊敬的 <strong>${name}</strong>，您好：</p>
      <p>感谢您选择 Ngan Ha Spa。</p>
      <p>我们很高兴地通知您，您的预约已成功受理。</p>
      
      ${isNewCustomer ? `
      <p>为了方便您付款，请扫描下方两个二维码中的任意一个完成支付：</p>
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr1}" alt="QR Code 1" width="200" height="200" />
        </div>
        <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
          <img src="${qr2}" alt="QR Code 2" width="200" height="200" />
        </div>
      </div>
      ` : `
      <p>作为老客户，您<strong>无需提前付款</strong>。您可以在到店后在前台直接支付。</p>
      `}
      
      <p style="margin-top: 20px;">如果您有任何疑问或需要更改预约，请直接回复此邮件。我们的客服团队随时为您提供帮助。</p>
      <p>祝您生活愉快！<br><strong>${process.env.SMTP_FROM_NAME}</strong></p>
    `,
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

    // Placeholder cho 2 mã QR (sẽ chỉ hiện nếu isNewCustomer = true)
    const qrPlaceholder1 = 'https://placehold.co/200x200/png?text=International+QR';
    const qrPlaceholder2 = 'https://placehold.co/200x200/png?text=Vietnam+QR';

    const htmlContent = template.content(customerName || 'Quý khách', isNewCustomer, qrPlaceholder1, qrPlaceholder2, bookingDetails);

    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
      replyTo: process.env.SMTP_REPLY_TO,
      to: toEmail,
      subject: template.subject,
      html: htmlContent,
    });

    console.log('[EmailService] Confirmation email sent successfully to', toEmail, 'Message ID:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EmailService] Error sending confirmation email:', error);
    return { success: false, error };
  }
}
