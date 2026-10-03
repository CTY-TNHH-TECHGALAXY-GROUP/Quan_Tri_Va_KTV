# Kế Hoạch Đồng Bộ Trạng Thái Điều Phối & Giải Phóng Phòng

## Vấn đề hiện tại
Anh đang gặp 2 vấn đề lớn trong giao diện điều phối của Lễ tân:
1. **"Quá trời trang (đơn) còn Đang làm"**: Tức là ở giao diện Bảng điều phối (Quick Dispatch), các đơn hàng vẫn kẹt ở cột/tab `IN_PROGRESS` (Đang làm) dù KTV đã nhấn hoàn tất dịch vụ.
2. **Lỗi không Giải phóng phòng**: Vì hệ thống nghĩ đơn hàng vẫn đang `IN_PROGRESS`, nên các giường/phòng của đơn hàng đó không bao giờ được trả lại trạng thái "Trống" (Available) để đón khách mới.

## Nguyên nhân (Root Cause)
Sau khi điều tra sự khác biệt giữa 2 trang Kanban (đúng) và Quick Dispatch (sai), em phát hiện ra lỗi nằm ở luồng KTV báo cáo hoàn thành:

- **Bên KTV API (`app/api/ktv/booking/route.ts`)**: Khi KTV nhấn "Hoàn tất" hoặc "Chuyển Feedback", API này CHỈ cập nhật trạng thái của các `BookingItems` (Dịch vụ con) thành `CLEANING` hoặc `FEEDBACK`.
- **ĐIỂM CHẾT**: API này **QUÊN** không gộp trạng thái của các dịch vụ con lại để tính ra trạng thái tổng của toàn bộ `Booking` (Đơn hàng mẹ).
- Do `Booking` (Đơn mẹ) không được chuyển sang `CLEANING`/`DONE`, nên giao diện Bảng điều phối (vốn phụ thuộc vào Đơn mẹ) sẽ giữ vĩnh viễn đơn đó ở trạng thái `IN_PROGRESS`. Mặc dù giao diện Kanban (vốn phụ thuộc vào Dịch vụ con) vẫn hiển thị đúng. 

## Giải Pháp Đã Triển Khai (Fixed)
Em đã áp dụng cơ chế **"Smart Booking Status Recomputation"** (Tự động tính toán lại trạng thái Đơn mẹ) vào ngay lúc KTV thao tác báo xong:

1. **Sửa file `app/api/ktv/booking/route.ts`**: Bất cứ khi nào KTV chuyển trạng thái một dịch vụ con thành `CLEANING` hoặc `FEEDBACK`, hệ thống sẽ tự động gọi hàm `recomputeBookingStatus()`.
2. Hàm này sẽ quét toàn bộ các dịch vụ của đơn:
   - Nếu tất cả dịch vụ đều xong/đang dọn phòng -> Tự động ép Đơn mẹ chuyển sang `CLEANING`.
   - Ngay lập tức, Đơn mẹ trên Bảng điều phối sẽ "thoát" khỏi tab `IN_PROGRESS`.
3. **Giải phóng phòng**: Logic đếm phòng bận `busyBedIds` của Lễ tân sẽ tự động loại bỏ các đơn không còn `IN_PROGRESS` hoặc `PREPARING`. Kết quả là ngay khi KTV bấm XONG, giường của họ lập tức được giải phóng trên màn hình Lễ tân để gán cho khách mới!

## Kết luận
Bản fix này đảm bảo:
✅ Trạng thái tổng (`Booking.status`) đồng nhất 1:1 với trạng thái dịch vụ (`BookingItems`).
✅ Giải quyết triệt để lỗi "đơn bị kẹt Đang làm" trên danh sách Lễ tân.
✅ Giường/Phòng tự động giải phóng ngay giây phút KTV hoàn thành thao tác trên máy của họ.
