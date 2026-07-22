# Kế Hoạch Sửa Lỗi Hiển Thị "Giờ Dự Kiến Về" Của Ca Tự Do Trên KTV Hub

## 1. Phân tích nguyên nhân
Dựa trên hình ảnh bạn gửi, khu vực đang xem là **Tab Lịch OFF** (hiển thị chi tiết nhân sự làm việc trong ngày được chọn trên Lịch). 
Trong source code, giao diện `LeaveOffTab` thực tế có 2 chế độ hiển thị danh sách nhân sự làm việc:
1. Chế độ xem theo ngày (trong Lịch OFF) - Hình ảnh bạn gửi.
2. Chế độ xem "Ca Hiện Tại" (trong Tab Phân Ca).

Trước đó, tôi chỉ mới cập nhật giao diện ở chế độ (2) và màn hình Sổ Tua, bỏ sót chế độ (1). Đồng thời, nếu ở Sổ tua vẫn chưa hiển thị, có thể do dữ liệu trong DB (những ca tự do được tạo trước khi thêm cột) đang có giá trị `null`, hoặc logic query lấy thiếu dữ liệu `estimatedEndTime`.

## 2. Phương án khắc phục (Chi tiết từng bước)

**Bước 1: Cập nhật giao diện "Chi tiết ngày - Nhân sự làm việc" (Tab Lịch OFF)**
- Chỉnh sửa vòng lặp render danh sách KTV trong `LeaveOffTab` (Dòng 1497+).
- Thay vì chỉ hiển thị `NH079`, nếu `shift.shiftType === 'FREE'` và có `shift.estimatedEndTime`, sẽ bổ sung thêm một thẻ nhỏ (badge) bên cạnh hiển thị `(Về: 16:30)`.

**Bước 2: Cập nhật giao diện "Sổ Tua" (Tab Hàng Đợi)**
- Sổ Tua (`TurnTab`) hiện đã có code render badge màu cam hiển thị giờ về. Tuy nhiên, nếu nó chưa lên, nguyên nhân có thể do API lấy dữ liệu `fetchExtras` đang map key bị sai (Ví dụ DB trả về `employeeId` kiểu camelCase nhưng component đọc kiểu khác). 
- Kiểm tra lại logic map dữ liệu ở hàm `fetchExtras` và cập nhật lại chắc chắn Sổ Tua đọc đúng `shifts[turn.employee_id].end`.

**Bước 3: Hiển thị mặc định nếu dữ liệu cũ chưa có**
- Do cột `estimatedEndTime` vừa được thêm vào, những KTV nào điểm danh Ca tự do *từ trước* sẽ mang giá trị `null` trong Database.
- Khi render, nếu là Ca tự do nhưng không có dữ liệu giờ về (do KTV cũ), hệ thống sẽ không hiển thị gì (hoặc hiển thị "Chưa cập nhật") để tránh lỗi giao diện.

## 3. Xin phép thực hiện
Bạn có đồng ý với hướng sửa lỗi này không? Nếu OK, tôi sẽ tiến hành cập nhật lại file `ktv-hub/page.tsx` ngay lập tức để đồng bộ hiển thị lên toàn bộ các màn hình của KTV Hub!
