# Kế hoạch sửa luồng thêm dịch vụ (Add-on) khi KTV đang làm
**(Đã duyệt theo Option A: Tự động gán cho KTV hiện tại & tự cộng dồn timer)**

## Mục tiêu
Fix hiện tượng KTV bị "chạy tầm bậy" (reset timer, mất trạng thái) khi Lễ tân thêm dịch vụ hoặc thêm thời gian (bản chất là thêm DV) vào một đơn hàng đang `IN_PROGRESS`.

## Chi tiết triển khai

### 1. Sửa lỗi Realtime KTV Dashboard (Bug #1)
- **File**: `app/ktv/dashboard/KTVDashboard.logic.ts`
- **Sửa**: Hàm listener `postgres_changes` cho `BookingItems`.
- **Logic**: Thay vì chỉ kiểm tra `payload.new.id === myItemId`, ta sẽ kiểm tra xem item mới có `bookingId` trùng với đơn đang chạy không.
  - Nếu trùng và là sự kiện `INSERT` → Gọi `fetchBooking()` để load toàn bộ item mới.
  - Nhờ vậy, KTV Dashboard sẽ tự tính toán tổng thời gian (merged timer) cho tất cả các dịch vụ chung phòng.

### 2. Sửa Action tạo Add-on (Bug #2, #3, #4)
- **File**: `app/reception/dispatch/actions.ts` (Hàm `addAddonServices`)
- **Logic Option A**:
  1. **Lấy KTV đang làm**: Tìm `technicianCodes` từ đơn hàng hiện tại, xác định KTV nào đang phục vụ (ví dụ lấy KTV từ item gốc).
  2. **Tạo Segments chuẩn**: Item mới chèn vào phải có mảng `segments` đầy đủ (gồm `ktvId`, `roomId`, `bedId` lấy từ item gốc đang chạy) để KTV Dashboard có thể tính toán thời gian (duration) và merge timer.
  3. **Cập nhật TurnQueue**: Chỉ tăng `estimated_end_time` cho các KTV THỰC SỰ được gán vào dịch vụ mới này, và đẩy item ID mới vào `booking_item_ids` của KTV đó.
  4. **Status**: Set status của item mới là `WAITING` hoặc `IN_PROGRESS` (tùy thuộc vào việc item gốc đã chạy chưa, nếu đang gộp phòng thì set cùng status `IN_PROGRESS` luôn để KTV tiếp tục làm).

## Các bước thực hiện
1. Lưu plan này vào thư mục `plans/`.
2. Sửa file `actions.ts`.
3. Sửa file `KTVDashboard.logic.ts`.
4. Báo cáo hoàn tất và yêu cầu user test thử.
