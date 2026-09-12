# Kế Hoạch: Áp dụng Chính Sách Tự Động Duyệt (Auto-Approve) Mọi Yêu Cầu KTV

## 1. Vấn đề hiện tại
- Yêu cầu "Nghỉ đột xuất" (`SUDDEN_OFF`) hoặc "Điểm danh bổ sung" trước đây đang phải trải qua 2 bước:
  1. KTV gửi -> Trạng thái **PENDING** (Đang chờ duyệt).
  2. Lễ tân/Quản lý ấn Đồng ý (nút Check xanh) hoặc Từ chối (nút X) trên thông báo.
- **Yêu cầu mới:** Spa có chính sách mở, mọi yêu cầu của nhân viên đều được đồng ý. Bỏ quy trình chờ phê duyệt, bỏ nút Tích/X trên thông báo để tiết kiệm thao tác.

## 2. Giải pháp thực hiện

### 2.1. Phía Backend API (`app/api/ktv/attendance/route.ts`)
- **Tắt PENDING:** Thay đổi logic `isAutoApprove = true` cho mọi loại `checkType` (Điểm danh, Tan ca, Nghỉ đột xuất).
- **Cập nhật dữ liệu ngay lập tức:**
  - Nếu là Điểm danh bình thường: tự động thêm vào `TurnQueue` (Danh sách tua) và cập nhật `isOnShift = true` (Đang trong ca).
  - Nếu là Nghỉ đột xuất / Xin OFF: tự động gỡ khỏi `TurnQueue` (`status = 'off'`) và cập nhật `isOnShift = false` (Ngoài ca).
- **Cập nhật Thông Báo (StaffNotifications):** Thêm thẻ `[AUTO]` vào nội dung thông báo (VD: "NH01 xin nghỉ đột xuất [AUTO]").

### 2.2. Phía Giao diện Quản lý / Lễ tân (`components/NotificationProvider.tsx`)
- Khi nhận thông báo có chứa thẻ `[AUTO]`, Component tự động nhận diện đây là thông báo "Chỉ để biết" (Info).
- **Ẩn nút Duyệt/Từ chối:** Hệ thống sẽ tự ẩn hai nút Check to và X to (nút Confirm/Reject điểm danh).
- Lễ tân sẽ chỉ thấy 1 nút Check nhỏ bên cạnh góc trái để bấm "Đánh dấu đã đọc" giúp làm sạch danh sách thông báo.

### 2.3. Phía Giao diện KTV (`app/ktv/attendance/page.tsx`)
- KTV gửi yêu cầu Nghỉ đột xuất xong -> Server trả ngay kết quả `CONFIRMED`.
- KTV sẽ nhảy thẳng qua màn hình màu xanh lá/xanh dương báo "Đã được ghi nhận" thay vì chờ mỏi mòn ở màn hình "Chờ phê duyệt" màu cam.

## 3. Kết luận
- KTV: Không còn trạng thái chờ đợi.
- Quản lý: Đỡ phải bấm duyệt tay từng yêu cầu nhỏ. Chỉ cần bấm 1 phát "Đóng tất cả thông báo" là xong.
- An toàn dữ liệu: Bảng tua (TurnQueue) và bảng trạng thái KTV vẫn được cập nhật tự động cực kỳ chính xác.
