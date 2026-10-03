# Kế hoạch hiển thị ghi chú của khách từ web VIP Menu lên trang quản trị

Vấn đề: Hiện tại khi khách đặt lịch từ web VIP Menu (hoặc web booking), ghi chú của khách hàng có thể được lưu vào cột `notes` (dưới dạng chuỗi hoặc JSON chứa thuộc tính `customerNote`), nhưng tại màn hình Điều Phối (trang quản trị), hệ thống chỉ đang trích xuất các thuộc tính tĩnh hoặc `receptionNote`, dẫn đến việc ghi chú của khách bị ẩn đi, đặc biệt trên giao diện "Điều Phối Nhanh" (Quick Dispatch).

## Đề xuất thay đổi

### 1. Trích xuất ghi chú từ trường `notes` trong `Bookings`
- **File:** `app/reception/dispatch/page.tsx`
- **Chi tiết:** Khi map dữ liệu từ DB thành `PendingOrder`, thêm logic trích xuất `customerNote` từ chuỗi JSON của `b.notes` (nếu `type` là `VIP_APPOINTMENT` hoặc `WEB_ADVANCE_BOOKING`).
- Nếu `b.notes` là chuỗi văn bản thông thường (không phải JSON), xem xét việc gộp luôn chuỗi đó vào thuộc tính ghi chú khách (`customerNote`) để Admin không bị lỡ thông tin.

### 2. Cập nhật chi tiết đơn từ Web Booking
- **File:** `app/reception/web-booking/WebBookingDetailPanel.tsx`
- **File:** `app/reception/web-booking/WebBookingCard.tsx`
- **Chi tiết:** Nếu đơn là `VIP_APPOINTMENT` hoặc `WEB_ADVANCE_BOOKING`, bổ sung logic lấy `parsedNotes.customerNote` hoặc `parsedNotes.note` gộp vào `finalNote` để hiển thị trên giao diện của lễ tân ngay khi đơn vừa đẩy về.

### 3. Cập nhật cho màn hình của KTV
- **File:** `app/api/ktv/booking/_handlers/handleGetBooking.ts`
- **Chi tiết:** Tương tự, bổ sung logic trích xuất `customerNote` từ JSON `notes` trong bảng `Bookings` để truyền xuống cho App KTV, đảm bảo KTV cũng nắm được các ghi chú này.
