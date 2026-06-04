# Kế hoạch thêm nút mở link dưới QR Code trên giao diện KTV

## Mục tiêu
Thêm một nút bấm bên dưới QR Code trên màn hình dashboard của KTV để KTV có thể click trực tiếp và mở link liên kết của mã QR trên trình duyệt thiết bị.

## Chi tiết thay đổi

### [app/ktv/dashboard/page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/page.tsx)
- Đưa state `bookingUrl` và logic fetch `web_booking_url` từ component con `WebBookingQR` lên component cha `ScreenDashboard`.
- Sửa component `WebBookingQR` nhận `url` qua props.
- Ở `ScreenDashboard`, phần QR Code, thêm một thẻ `<a>` với style Tailwind chuẩn spa-themed (nền emerald nhạt, viền nhẹ, bo tròn, có hiệu ứng hover & click mượt mà) để mở liên kết đó trong một tab mới (`target="_blank"`).

## Verification Plan
1. Mở trang dashboard của KTV.
2. Kiểm tra xem dưới mã QR có xuất hiện nút "Mở liên kết" với icon đi kèm hay không.
3. Nhấp vào nút đó xem nó có mở ra đúng trang đặt lịch (Web Booking) trong một tab mới hay không.
