# Kế Hoạch Triển Khai: Chỉnh Sửa Thời Gian Dịch Vụ Bằng Cách Chuột Phải Ở Kanban

Cập nhật tính năng cho phép người dùng click chuột phải vào thẻ dịch vụ trên bảng Kanban để trực tiếp chỉnh sửa giờ bắt đầu và kết thúc của dịch vụ (thay vì phụ thuộc hoàn toàn vào KTV Dashboard).

## User Review Required

> [!WARNING]
> Việc sửa giờ tay có thể ảnh hưởng đến logic phân bổ thời gian thực (realtime) của KTV. Khi Lễ tân sửa giờ, ta sẽ ép cập nhật `startTime` / `actualStartTime` trên server, đồng thời thông báo qua Realtime để ứng dụng của KTV tự động tải lại (tránh lỗi lệch giờ). Bạn đồng ý với cơ chế ghi đè cứng này không?

## Proposed Changes

### 1. `app/reception/dispatch/_components/KanbanBoard.tsx`
- Sửa lại hàm callback `onContextMenu` để trả về cả ID của `BookingItem` (dịch vụ cụ thể bị chuột phải), không chỉ trả về `orderId`.

### 2. `app/reception/dispatch/page.tsx`
- Bổ sung state để quản lý `TimeEditorModal` (modal chỉnh sửa thời gian).
- Mở rộng menu chuột phải (Context Menu) hiện tại: thêm lựa chọn "Sửa thời gian dịch vụ" nếu chuột phải vào một dịch vụ cụ thể.
- Thêm giao diện popup `TimeEditorModal` hiển thị 2 thẻ `<input type="time" />` (hoặc picker) để sửa `actualStartTime` và `actualEndTime`.
- Viết logic gọi Supabase `update` bảng `BookingItems` để lưu lại thời gian mới.

## Verification Plan

### Manual Verification
- Lễ tân chuột phải vào thẻ trên Kanban, chọn "Sửa thời gian".
- Lễ tân nhập thời gian mới và lưu.
- UI trên dispatch/kanban tải lại và hiển thị giờ mới.
- Ứng dụng KTV Dashboard nhận được thay đổi (thông qua luồng subscription hiện tại) và cập nhật số phút đồng hồ đếm ngược (nếu đang chạy).
