# Kế Hoạch Refactor Kiến Trúc Sang Mô Hình "BookingGuests"

Dựa trên yêu cầu của bạn: *"Bảo vệ các đơn cũ, từ ngày 18 trở đi sẽ làm theo cách mới (dùng BookingGuests) và đồng bộ flow tạo đơn nhanh"*, tôi đã lập kế hoạch refactor toàn diện và cực kỳ an toàn như sau:

## 1. Triết Lý Kiến Trúc Mới (BookingGuests Architecture)
Thay vì dùng biến cờ `mergedIntoId` lằng nhằng ở cấp độ Dịch vụ (BookingItems), chúng ta sẽ nâng cấp toàn bộ hệ thống lên kiến trúc 3 lớp:
- **Lớp 1 (Bookings):** Quản lý trạng thái tổng và Thanh toán tổng.
- **Lớp 2 (BookingGuests) - "Dịch vụ Ảo":** Quản lý Nhóm dịch vụ của từng khách. KTV sẽ được gán và thao tác dựa trên lớp này. Toàn bộ logic Timer, Dọn phòng, Bàn giao đều xoay quanh Guest.
- **Lớp 3 (BookingItems):** Trở thành "Hóa đơn tính tiền" và chia hoa hồng thuần túy. Trạng thái của Items sẽ tự động nội suy (sync) theo trạng thái của Guest.

> [!TIP]
> **Khả năng Tương thích ngược (Backward Compatibility)**
> Để bảo vệ các đơn cũ trước ngày 18/08, hệ thống sẽ tự động check: NẾU đơn hàng có `BookingGuests`, nó sẽ chạy theo Flow Mới. NẾU KHÔNG, nó sẽ fallback về Flow Cũ (dùng `mergedIntoId`).

## 2. Các Bước Triển Khai (Implementation Steps)

### Bước 1: Frontend - Bảng Điều Phối (`QuickDispatchTable.tsx` & `useDispatchBoard.logic.ts`)
- Đổi cơ chế hiển thị: Thay vì nhóm các dịch vụ bằng nút "Gộp dịch vụ", hệ thống sẽ tự động vẽ ra các Card dựa trên danh sách `BookingGuests`.
- Mỗi Guest Card sẽ liệt kê các `BookingItems` bên trong.
- Bỏ nút "Gộp/Tách dịch vụ" thủ công đi (vì Lễ tân chỉ cần xếp dịch vụ vào đúng Guest là xong).
- Khi kéo thả KTV, KTV sẽ được gắn cho **toàn bộ nhóm dịch vụ của Guest đó**.

### Bước 2: KTV Dashboard API (`handleStartTimer.ts` & `handleFinishService.ts`)
- Đổi cơ chế "Smart Sync": Khi KTV bấm Bắt đầu / Dọn phòng, API sẽ tìm `guest_id` thay vì `mergedIntoId`.
- Cập nhật trạng thái đồng loạt cho tất cả các Items có cùng `guest_id` dựa trên **Trọng số Trạng thái** (để đảm bảo không bị đè ngược về Chuẩn bị).

### Bước 3: Đồng Bộ Luồng "Tạo Đơn Nhanh" (`AddOrderModal.tsx` & `actions.ts`)
- Kiểm tra lại hàm `createQuickBooking`: Đảm bảo khi tạo đơn, nó tạo chuẩn xác `BookingGuests` và link `BookingItems` với `guest_id` tương ứng.
- **Xử lý Đơn TEST:** Đảm bảo khi tích chọn "Đơn Test", hệ thống sinh mã ngẫu nhiên nhưng VẪN chạy qua đúng hàm tạo của luồng chính (không bị khuyết thiếu bảng Guests).
