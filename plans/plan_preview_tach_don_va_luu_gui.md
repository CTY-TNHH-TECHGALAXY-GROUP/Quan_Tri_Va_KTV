# Kế hoạch triển khai: Preview Tách Đơn & Tích hợp Lưu - Gửi

## 1. Mục tiêu
- **Nâng cấp UX cho Lễ tân:** Có cái nhìn trực quan (Preview) về việc hệ thống sẽ tách đơn như thế nào trước khi thực sự ghi xuống DB.
- **Hợp nhất hành động:** Tích hợp chức năng Lưu Nháp và Gửi KTV (Điều Phối) vào chung một luồng để tránh trùng lặp code và giảm số thao tác click cho Lễ tân.

## 2. Phân tích Hiện trạng & Vấn đề
- **Hiện tại:** Nút "Lưu Nháp" gọi `handleSaveDraft()`, nó ngầm gọi RPC `split_booking_into_sub_bookings`, tách xong thì hiện một cái `alert()` nhàm chán.
- **Hiện tại:** Nút "Điều Phối" gọi `handleDispatch()`, nó CŨNG chứa một đoạn code duplicate gọi RPC `split_booking_into_sub_bookings`. Đôi khi Lễ tân bấm Gửi KTV nhưng quên Lưu Nháp trước đó dẫn đến nguy cơ lỗi đồng bộ dữ liệu.

## 3. Giải pháp Kỹ thuật (Chi tiết)

### Bước 1: Tạo Component `SplitPreviewModal`
Tạo một popup hiển thị trước khi lưu. Logic:
- Khi user bấm nút `Lưu Nháp` (hoặc `Gửi & Dọn Phòng`), hệ thống tính toán danh sách `groups` (nhóm Khách A, Khách B).
- Nếu `groups.size > 1` (phát hiện sắp tách đơn), chặn lại và hiện `SplitPreviewModal`.
- **Giao diện Modal:**
  - Tiêu đề: "Hệ thống sẽ tách thành X đơn con"
  - Danh sách: 
    - Khách A: Dịch vụ Massage...
    - Khách B: Dịch vụ Gội đầu...
  - Nút bấm dưới cùng: 
    1. `[Hủy]`
    2. `[Chỉ Lưu Nháp]` (Chạy `handleSaveDraft`)
    3. `[Lưu & Gửi KTV luôn]` (Chạy `handleSaveDraft` rồi nối tiếp `handleDispatch`)

### Bước 2: Refactor `handleSaveDraft` và `handleDispatch`
- Đảm bảo `handleSaveDraft` là nơi xử lý logic gọi RPC `split_booking_into_sub_bookings` và update DB (Lưu note, phòng, giường).
- Gỡ bỏ đoạn code duplicate tách đơn bên trong `handleDispatch()`.
- Chỉnh sửa `handleDispatch()` sao cho nó gọi chung luồng với việc lưu, hoặc chỉ tập trung vào việc **bắn lệnh cho KTV**.

### Bước 3: Cập nhật luồng Nút Điều Phối (Dispatch Button)
- Nút Dispatch (màu tím) hiện tại gọi `showDispatchConfirmModal`.
- Trong Modal đó, khi bấm `[Gửi & Dọn Phòng]`, thay vì gọi thẳng `handleDispatch`, hệ thống sẽ:
  - Check xem có cần tách đơn không? (Nếu có thì hiện Preview).
  - Lưu toàn bộ thay đổi (gọi chung luồng Save Draft).
  - Sau đó gọi lệnh Gửi KTV.

## 4. Các File Cần Chỉnh Sửa
1. `app/reception/dispatch/_components/SplitPreviewModal.tsx` **[NEW]**: Chứa UI của popup preview.
2. `app/reception/dispatch/page.tsx` **[MODIFY]**: Tích hợp Modal, sửa logic `handleSaveDraft` và `handleDispatch`, xóa code duplicate.
