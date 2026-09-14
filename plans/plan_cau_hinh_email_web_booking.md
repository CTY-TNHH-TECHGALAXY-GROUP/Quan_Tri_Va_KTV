# Kế hoạch cấu hình gửi Email (SMTP) & Xác Nhận Đặt Lịch

Dưới đây là kế hoạch chi tiết để tích hợp hệ thống gửi Email tự động trong dự án Next.js, bao gồm cấu hình SMTP đã được xác thực và việc tự động gửi thư xác nhận đặt lịch kèm mã QR thanh toán theo 5 ngôn ngữ.

## 1. Cấu hình Môi trường (Environment Variables)
Cập nhật các biến môi trường vào file `.env.local`:
```env
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_USER=info@techgalaxygroup.com
SMTP_PASS=FSwZfz5vLUyc
SMTP_FROM_NAME="Info Ngan Ha - Techgalaxygroup"
SMTP_FROM_EMAIL=info@techgalaxygroup.com
SMTP_REPLY_TO=cskh@techgalaxygroup.com
```

## 2. Cài đặt thư viện
- Chạy lệnh cài đặt `nodemailer` và `@types/nodemailer`.

## 3. Core Module Gửi Email (`lib/email.ts`)
Tạo file module dùng chung với chức năng:
- **`transporter`**: Khởi tạo kết nối SMTP từ Zoho.
- **`sendEmail(to, subject, htmlContent)`**: Hàm cốt lõi để gửi thư với thông tin cố định (From Email, Reply-To Email).
- **`sendBookingConfirmationEmail(customerEmail, customerName, language)`**: Hàm chịu trách nhiệm gửi form Xác nhận đơn hàng. Tạm thời sẽ sử dụng ảnh QR Code mặc định.

## 4. Xây dựng Template Email Đa Ngôn Ngữ
Hệ thống sẽ dựa vào biến ngôn ngữ của khách hàng (`vi`, `en`, `kr`, `jp`, `cn`) để tự động chọn nội dung phù hợp. Hai mã QR thanh toán sẽ được đính kèm vào email.

- **vi:** Xác nhận đặt lịch thành công - Ngan Ha Spa
- **en:** Booking Confirmation - Ngan Ha Spa
- **kr:** 예약 확인 - Ngan Ha Spa
- **jp:** ご予約の確認 - Ngan Ha Spa
- **cn:** 预约确认 - Ngan Ha Spa

## 5. Tích hợp vào Luồng Đặt Lịch (Booking Flow)
Sẽ cập nhật hàm `confirmWebBooking` trong `app/reception/web-booking/actions.ts`.
- **Hành động (Trigger):** Khi Lễ tân ấn nút **"Xác nhận"** ở màn hình Quản lý Web Booking.
- **Logic thực thi:** Kiểm tra đơn booking xem có lưu Email của khách không và xác định ngôn ngữ (customerLang). Sau đó gọi hàm `sendBookingConfirmationEmail()` để gửi thư đi một cách bất đồng bộ.
