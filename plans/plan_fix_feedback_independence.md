# Refactor: Độc Lập Hóa Dữ Liệu Đánh Giá (Feedback) Của Từng Khách

Tính năng nhận đánh giá (Feedback) hiện tại đang lưu số sao (rating) và trạng thái lên bảng cha `Bookings`. Điều này gây lỗi ghi đè dữ liệu nếu nhóm khách có nhiều người đánh giá khác nhau. 

Kế hoạch này sẽ cấu trúc lại luồng ghi dữ liệu: Đảm bảo khách nào đánh giá thì lưu đúng vào dòng của khách đó trong bảng `BookingGuests`, không làm ảnh hưởng đến người khác.

> [!WARNING]
> Thay đổi này liên quan trực tiếp đến luồng Checkout và hiển thị trên Kanban Lễ Tân. Xin vui lòng đọc kỹ phần "Open Questions" trước khi duyệt!

## User Review Required

### 1. Bảng Kanban Dispatch Board (Của Lễ Tân)
Bảng Dispatch (quản lý phòng/lên turn) của Lễ Tân hiện tại đang hiển thị **theo nhóm (Bookings)** chứ không tách riêng từng khách. Thẻ Booking trên Kanban có dòng chữ `Đánh giá: Xuất sắc (4/4)`.
**Vấn đề:** Nếu nhóm 3 khách đánh giá độc lập (Khách 1 cho 5 sao, Khách 2 cho 2 sao), thì thẻ Booking trên Kanban của Lễ Tân sẽ hiển thị số sao như thế nào? 
**Đề xuất của AI:** Tôi sẽ tính **Trung bình cộng** số sao của tất cả các khách trong nhóm đã đánh giá để hiển thị lên thẻ Kanban (VD: Trung bình 3.5 sao -> Tốt).

### 2. Trạng thái (Status) của Bookings
Trước đây, hễ 1 khách bấm Submit Feedback là bảng `Bookings` cha bị chuyển status sang `FEEDBACK`.
**Đề xuất của AI:** Tôi sẽ KHÔNG đổi trạng thái của bảng cha `Bookings` nữa. Thay vào đó, bảng `Bookings` chỉ chuyển sang `FEEDBACK` khi **TẤT CẢ** các khách trong nhóm đã đánh giá xong, HOẶC trạng thái của đơn cha được quyết định bởi Lễ Tân/Luồng Checkout. Tạm thời luồng Feedback của Khách lẻ sẽ chỉ update trạng thái của Khách lẻ.

## Proposed Changes

### [Màn hình Kiosk iPad]

Sửa đổi file logic của Kiosk iPad để trỏ dữ liệu vào bảng `BookingGuests`.

#### [MODIFY] `app/reception/feedback/_components/KioskFeedback.logic.ts`
- **Tách luồng:** NẾU `isGuestFlow == true` (Đơn được chia khách):
  - Dùng `booking.id` (Chính là ID của BookingGuest) để gọi hàm `update` vào bảng `BookingGuests`.
  - Cập nhật `rating`, `guest_feedback`, và `status = 'FEEDBACK'` cho khách đó.
  - Cập nhật `ktv_ratings` cho bảng `BookingItems` của khách đó.
  - **Kích hoạt Webhook:** Insert vào bảng `StaffNotifications` kèm theo ID của `BookingGuest` và Tên khách để báo cho KTV biết chính xác ai vừa đánh giá mình.
  - KHÔNG ghi đè bảng cha `Bookings`.
- Nếu `isGuestFlow == false` (Đơn cũ không chia khách): Giữ nguyên luồng ghi đè `Bookings` như cũ để tương thích ngược.

### [Màn hình Dispatch Board Lễ Tân]

Sửa đổi cách lấy điểm hiển thị trên thẻ Kanban.

#### [MODIFY] `app/reception/dispatch/useDispatchBoard.logic.ts`
- Cập nhật cách tính toán biến `calculatedRating`: Thay vì đọc từ `Bookings.rating` (bị trống), hệ thống sẽ đọc tất cả `b.BookingGuests`, lọc ra những người đã có `rating` và tính Trung bình cộng để hiển thị màu sắc trên thẻ Kanban.
- Kiểm tra lại logic chuyển cột trên Kanban (dựa vào Status) để đảm bảo thẻ không bị kẹt.

## Verification Plan

### Manual Verification
1. Lễ Tân mở 1 đơn nhóm có 2 khách.
2. Trên màn hình Feedback, Khách A quét QR và đánh giá 5 sao. Khách B quét QR và đánh giá 2 sao.
3. **Kỳ vọng 1:** Webhook Zalo/App bắn về 2 thông báo độc lập với nội dung rõ ràng cho từng Khách.
4. **Kỳ vọng 2:** Màn hình Feedback Dashboard báo Khách A (5 sao - xanh lá), Khách B (2 sao - đỏ).
5. **Kỳ vọng 3:** Màn hình Kanban Lễ Tân hiển thị thẻ Booking với trung bình là 3.5 sao (Tốt).
