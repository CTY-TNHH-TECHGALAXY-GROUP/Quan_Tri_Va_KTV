# Tóm tắt Kế hoạch: Tính năng Bật/Tắt gửi Email Yêu cầu Đặt cọc (Web Booking)

## Mục tiêu
Tạo một "Công tắc" (Feature Flag) trên giao diện Quản trị để Mở/Đóng tính năng gửi Email yêu cầu đặt cọc cho Đơn đặt từ Web.
Lễ tân **VẪN SẼ NHẬN** và Xác nhận đơn bình thường để test luồng điều phối, nhưng hệ thống sẽ chặn việc gửi Email đến tester ảo.

## Phương án Triển khai chi tiết

### 1. Database (Bảng SystemConfigs) & Cấu hình mặc định
- Bổ sung biến cấu hình: `enable_web_advance_booking_email`.
- Thiết lập giá trị mặc định lúc này là `false` (Không tự động gửi mail khi Lễ tân bấm Xác nhận).

### 2. Giao diện Quản trị (`app/admin/settings/system/page.tsx`)
- Thêm 1 nút Công tắc gạt (Toggle Switch) có tên: **"Tự động gửi Email xác nhận đặt cọc cho Đơn Web"**.
- Nút này sẽ được kết nối với API `/api/admin/settings/system` để lưu trữ trạng thái Bật/Tắt (biến `enable_web_advance_booking_email`) vào Database.
- Tính năng này giúp Quản lý có thể chủ động Bật lại luồng gửi Mail khi Website chính thức hoàn thiện và mở cho khách hàng thật (Go-live).

### 3. Logic chặn Email (`app/reception/web-booking/actions.ts`)
- Mở hàm `confirmWebBooking()` (hàm chạy khi Lễ tân bấm Xác nhận đơn).
- Lấy giá trị của `enable_web_advance_booking_email` từ bảng `SystemConfigs`.
- Viết thêm thuật toán:
  - Nếu `enable_web_advance_booking_email == true`: Xác nhận đơn xong -> Chạy hàm `sendBookingConfirmationEmail()` để bắn mail đi.
  - Nếu `enable_web_advance_booking_email == false`: Xác nhận đơn xong -> **Bỏ qua** bước bắn Mail (Khách sẽ không nhận được Email) -> Kết thúc thành công.

## Lợi ích
- Vẫn có thể test luồng chạy đơn từ Web sang Lễ tân, từ Lễ tân sang Điều phối một cách trơn tru.
- Không gửi những bức Email "Vui lòng đặt cọc 50%" tới khách hàng ảo đang test nội bộ.
- Dễ dàng Bật lại (Go-live) tính năng gửi mail chỉ bằng 1 nút bấm trên màn hình Admin.
