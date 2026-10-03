# Kế Hoạch Bổ Sung Các Sổ Công Cụ Vào Trang Điều Phối

Được phê duyệt ngày: 2026-07-18

## 1. Mở rộng thanh chuyển đổi chế độ (Mode Switcher)
Nâng cấp thanh tab với 5 chế độ:
- `DISPATCH`: Điều Phối (Hiện tại)
- `MONITOR`: Giám Sát Đơn (Hiện tại)
- `TURN_QUEUE`: Sổ Tua (Mới)
- `ROOMS`: Sổ Phòng (Mới)
- `SCHEDULE`: Lịch Biểu Diễn (Mới)

## 2. Tích hợp Sổ Tua
- Sử dụng trực tiếp Component `TurnQueueBoard` ở `components/shared/TurnQueueBoard`.

## 3. Đóng gói & Tích hợp "Mục Quản Lý Phòng" (RoomBoard)
- **Cấu trúc Component mới:** `components/shared/RoomBoard/RoomBoard.tsx`
- **Tính năng:**
  - Hiển thị danh sách tất cả các Phòng (Rooms) và Giường (Beds) trong Spa.
  - Thông tin chi tiết: Nắm rõ **phòng nào bận**, **giường mấy bận**, **KTV nào đang làm**, và **làm đến mấy giờ**.
  - Phân loại trực quan (Màu sắc theo trạng thái): Trống, Đang làm, Đang dọn dẹp.

## 4. Đóng gói & Tích hợp "Lịch Biểu Diễn" (ScheduleBoard)
- **Cấu trúc Component mới:** `components/shared/ScheduleBoard/ScheduleBoard.tsx`
- **Tính năng:**
  - Hiển thị danh sách các Đơn Hàng (Bookings) theo dòng thời gian trong ngày.
  - Hiển thị dưới dạng Khối Danh Sách theo khung giờ để dễ nhìn trên điện thoại/tablet.
