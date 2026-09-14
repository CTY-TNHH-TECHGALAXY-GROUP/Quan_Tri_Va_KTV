# Kế hoạch: Đồng bộ chuyển trang khi Hoàn thành sớm

Khi Lễ tân (Admin) duyệt yêu cầu về sớm tại màn hình Dispatch (Giám sát/Điều phối) và cập nhật đơn hàng thành **Hoàn thành (COMPLETED)**, hệ thống chỉ đang cập nhật trạng thái của toàn bộ đơn (`Bookings`), mà bỏ quên việc cập nhật trạng thái chi tiết của các dịch vụ bên trong (`BookingItems`).

Do App KTV và App Khách Hàng (Customer Journey) lấy trạng thái từ từng dịch vụ (`BookingItems`), việc thiếu cập nhật này khiến hai ứng dụng trên bị kẹt ở màn hình đang đếm giờ (IN_PROGRESS).

## Khắc phục sự cố

Sửa hàm xử lý tập trung tại `app/reception/dispatch/actions.ts` (Nơi điều khiển logic của phần Dispatch & Giám sát đã được gộp lại).

### Sửa file `app/reception/dispatch/actions.ts`

**1. API `updateBookingStatus`:**
- Khi tham số `newStatus` là `COMPLETED`, `DONE` hoặc `CANCELLED`, ngay sau khi update bảng `Bookings`, hệ thống cập nhật trạng thái tương ứng cho toàn bộ `BookingItems` của đơn hàng đó.
- Lệnh sử dụng: `supabase.from('BookingItems').update({ status: newStatus }).eq('bookingId', bookingId).not('status', 'in', '("DONE","CANCELLED")')`.

**2. API `cancelBooking`:**
- Tương tự, bổ sung logic hủy toàn bộ các `BookingItems` đang chạy đưa về trạng thái `CANCELLED`.

### Kết quả

1. Khi Lễ tân ấn `Hoàn thành dịch vụ` trên Kanban board của phần Điều phối / Giám sát.
2. Trạng thái của cả Booking & BookingItems đều chuyển thành `COMPLETED`.
3. App KTV sẽ nhận realtime được cập nhật, tự động nhảy sang trang **Review / Bàn giao**.
4. App Khách hàng (Journey) nhận realtime, tự động nhảy sang trang **Kiểm tra đồ cá nhân** & **Đánh giá**.
