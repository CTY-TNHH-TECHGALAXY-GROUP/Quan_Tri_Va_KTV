# Oria Spa Booking Email Template

Dưới đây là mã nguồn HTML (layout template) thực tế được sử dụng để gửi email xác nhận cho khách hàng. Template này đã được code theo chuẩn Email Marketing (sử dụng `<table>` để tương thích với mọi hòm thư điện tử như Gmail, Outlook, Apple Mail), tích hợp CSS dạng inline và sử dụng bộ màu thương hiệu của Oria Spa.

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Xác nhận đặt lịch | Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #1a120e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f7ebc7;">
  
  <div style="background-color: #1a120e; padding: 32px 16px;">
    <!-- MAIN CONTAINER -->
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #281b15; border-radius: 18px; overflow: hidden; border: 1px solid #4a352a; box-shadow: 0 10px 30px rgba(0,0,0,0.55);">
      
      <!-- BRAND HEADER WITH LOGO -->
      <tr>
        <td align="center" style="padding: 28px 24px 20px; background: linear-gradient(180deg, #1f140f 0%, #281b15 100%); border-bottom: 1px solid #422f25;">
          <a href="https://nganha.vercel.app" target="_blank" style="text-decoration: none; display: inline-block;">
            <img 
              src="https://nganha.vercel.app/images/logo.png" 
              alt="ORIA SPA - Wellness & Beauty Sanctuary" 
              width="145" 
              style="display: block; margin: 0 auto; max-width: 145px; width: 145px; height: auto; border: 0; outline: none; text-decoration: none; filter: sepia(100%) hue-rotate(5deg) saturate(300%) brightness(1.2);" 
            />
          </a>
        </td>
      </tr>

      <!-- BODY CONTENT -->
      <tr>
        <td style="padding: 32px 28px 28px;">
          <!-- GREETING -->
          <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #ffffff;">
            Xin chào anh/chị [Tên Khách Hàng],
          </p>
          <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.7; color: rgba(247, 235, 199, 0.9);">
            Cảm ơn quý khách đã tin tưởng và đặt lịch tại Oria Spa. Dưới đây là thông tin chi tiết về lịch hẹn của quý khách:
          </p>

          <!-- DETAILS CARD -->
          <div style="background-color: #1f1510; border: 1px solid #473328; border-radius: 14px; padding: 22px 24px; margin-bottom: 24px;">
            <div style="font-family: 'Playfair Display', Georgia, serif; font-size: 15px; font-weight: 600; color: #D4AF37; letter-spacing: 0.5px; margin-bottom: 16px;">
              CHI TIẾT LỊCH HẸN
            </div>
            
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.7;">
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); width: 38%; min-width: 110px; vertical-align: top;">
                  • <strong>Dịch vụ:</strong>
                </td>
                <td style="padding: 5px 0; color: #ffffff; font-weight: 500; vertical-align: top;">
                  Aroma coconut oil
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>Ngày hẹn:</strong>
                </td>
                <td style="padding: 5px 0; color: #ffffff; font-weight: 500; vertical-align: top;">
                  Tháng 9 03, 2026
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>Thời gian:</strong>
                </td>
                <td style="padding: 5px 0; color: #D4AF37; font-weight: 600; vertical-align: top;">
                  14:30
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>Thời lượng:</strong>
                </td>
                <td style="padding: 5px 0; color: #ffffff; vertical-align: top;">
                  90 mins
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>Số lượng khách:</strong>
                </td>
                <td style="padding: 5px 0; color: #ffffff; font-weight: 500; vertical-align: top;">
                  2 khách
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>KTV yêu cầu:</strong>
                </td>
                <td style="padding: 5px 0; color: #ffffff; font-weight: 500; vertical-align: top;">
                  Ngẫu nhiên
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>Chi nhánh:</strong>
                </td>
                <td style="padding: 5px 0; color: #ffffff; vertical-align: top;">
                  ORIA SPA
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: rgba(247, 235, 199, 0.6); vertical-align: top;">
                  • <strong>Mã đơn:</strong>
                </td>
                <td style="padding: 5px 0; color: #D4AF37; font-weight: bold; letter-spacing: 0.5px; vertical-align: top;">
                  WB-005-03092026
                </td>
              </tr>
              
              <!-- TOTAL PRICE -->
              <tr>
                <td style="padding: 7px 0; color: rgba(247, 235, 199, 0.6); vertical-align: middle;">
                  • <strong>Tổng tiền:</strong>
                </td>
                <td style="padding: 7px 0; color: #D4AF37; font-weight: bold; font-size: 16px; white-space: nowrap; vertical-align: middle;">
                  1.160.000&nbsp;₫
                </td>
              </tr>
              
              <!-- PREFERENCES / GHI CHÚ ĐIỀU TRỊ (Chỉ hiện khi có) -->
              <tr>
                <td colspan="2" style="padding: 12px 0 6px; border-top: 1px dashed rgba(247, 235, 199, 0.15);">
                  <div style="color: #D4AF37; font-size: 13px; font-weight: 600; margin-bottom: 8px;">
                    • Yêu cầu điều trị:
                  </div>
                  <!-- Khung Preferences Render (Custom For You) -->
                  <div style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;">
                    <div style="margin-bottom: 6px;">
                      <span style="color: #D4AF37; font-weight: 600; margin-right: 6px; font-size: 13px;">Tập trung:</span>
                      <span style="color: #f7ebc7; font-size: 13px;">Đầu, Cổ vai gáy</span>
                    </div>
                    <div style="margin-bottom: 6px;">
                      <span style="color: #D4AF37; font-weight: 600; margin-right: 6px; font-size: 13px;">Bỏ qua:</span>
                      <span style="color: #f7ebc7; font-size: 13px;">Bụng</span>
                    </div>
                    <div style="margin-bottom: 0;">
                      <span style="color: #D4AF37; font-weight: 600; margin-right: 6px; font-size: 13px;">Lực massage:</span>
                      <span style="color: #f7ebc7; font-size: 13px;">Mạnh (Strong)</span>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- GHI CHÚ CHUNG (Chỉ hiện khi có) -->
              <tr>
                <td colspan="2" style="padding: 12px 0 6px; border-top: 1px dashed rgba(247, 235, 199, 0.15);">
                  <div style="color: #D4AF37; font-size: 13px; font-weight: 600; margin-bottom: 6px;">
                    • Ghi chú thêm:
                  </div>
                  <div style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 8px; padding: 10px 14px; color: #f7ebc7; font-size: 13px; line-height: 1.6; white-space: pre-line; font-style: italic;">
Quý khách bị dị ứng với tinh dầu bạc hà, vui lòng thay bằng tinh dầu tràm trà.
                  </div>
                </td>
              </tr>
              
            </table>
          </div>

          <!-- FOLLOW UP NOTE -->
          <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.7; color: rgba(247, 235, 199, 0.9);">
            Để đảm bảo có trải nghiệm tốt nhất, quý khách vui lòng đến trước 10 phút. Nếu có bất kỳ thay đổi nào, mong quý khách báo lại cho chúng tôi sớm.
          </p>

          <!-- QUESTIONS -->
          <p style="margin: 0 0 28px; font-size: 14px; line-height: 1.7; color: rgba(247, 235, 199, 0.9);">
            Mọi thắc mắc xin vui lòng liên hệ hotline <a href="tel:+84964090277" style="color: #D4AF37; text-decoration: none; font-weight: 600;">+84 964 090 277</a>.
          </p>

          <!-- SIGNOFF -->
          <div style="border-top: 1px solid #422f25; padding-top: 20px;">
            <p style="margin: 0 0 4px; font-size: 14px; color: rgba(247, 235, 199, 0.8);">
              Trân trọng,
            </p>
            <p style="margin: 0; font-size: 15px; font-weight: 600; color: #D4AF37; font-family: 'Playfair Display', Georgia, serif;">
              Đội ngũ Oria Spa
            </p>
          </div>
          
        </td>
      </tr>
    </table>
  </div>
  
</body>
</html>
```
