# Tích hợp Nút Bật Nhận Đơn cho KTV Loại A (Nhận đơn ngoài giờ)

Tính năng này giúp KTV Loại A (nhân viên cố định) có thể tự do bật/tắt chế độ nhận đơn từ xa (khi ở nhà, hoặc ngày OFF) nếu được Admin cấp quyền "Nhận đơn ngoài giờ". KTV Loại A sẽ thao tác trực tiếp trên giao diện Chấm Công (IDLE) của họ.

## Môi trường & Luồng hiện tại
1. API `/api/ktv/on-call` đã hỗ trợ bật/tắt nhận đơn cho KTV Loại A (nếu cờ `feature_flags.allow_on_call` = true).
2. Khi bật, `online_status` của KTV đó sẽ thành `ONLINE` (được ghi nhận trong hệ thống điều phối `KtvAssignments`).
3. Giao diện chấm công của KTV Loại A (trạng thái `IDLE`) hiện tại chỉ có một nút "Ngân Hà Xin Chào" (Check-in). Nó không render được `AttendanceTypeB`.

## Proposed Changes

### Component Name: UI KTV Loại A (Trang Chấm Công)

#### [NEW] `app/ktv/attendance/_components/OnCallWidget.tsx`
Tạo một component nhỏ gọn, dùng để hiển thị nút Bật/Tắt Nhận Đơn và xử lý việc nhập số phút, gọi API.
Component này sẽ:
- Gọi API GET `/api/ktv/on-call` mỗi 30s.
- Nếu `allow_on_call === true`:
  - Trạng thái TẮT: Hiển thị nút "Bật Nhận Đơn".
  - Trạng thái BẬT: Hiển thị trạng thái "Đang sẵn sàng từ nhà..." và nút "Tắt Nhận Đơn".
- Tích hợp sẵn Popup nhập số phút giống hệt KTV Loại B.

#### [MODIFY] `app/ktv/attendance/page.tsx`
- Import `<OnCallWidget>` vào trang.
- Ở trạng thái `IDLE` (trước khi điểm danh), ngay bên dưới nút "Ngân Hà Xin Chào", thêm `<OnCallWidget ktvId={user.code} />` cho KTV Loại A.

### Component Name: API Điểm Danh (Backend)

#### [MODIFY] `app/api/ktv/attendance/route.ts`
- **Root Cause**: Khi KTV Loại A ở nhà "Bật nhận đơn" (chuyển sang `ONLINE`), sau đó họ đi tới Spa và bấm "Ngân Hà Xin Chào" (để Check-in và vào ca bình thường). Do luồng cũ chưa xử lý tắt cờ `ONLINE` cho KTV Loại A khi check-in, nên họ sẽ vừa bị dính trạng thái `ONLINE` (ngoài giờ) vừa nằm trong `TurnQueue` (trong ca).
- **Solution**: Thêm một dòng `await KtvOnlineService.goOffline(supabase, staffCode);` vào nhánh xử lý `checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN'` của **KTV Loại A** để xóa sạch trạng thái nhận đơn từ xa của họ khi đã có mặt ở Spa.

## Verification Plan

### Manual Verification
1. Đăng nhập vào KTV Loại A. 
2. Chắc chắn Admin đã tích "Nhận đơn ngoài giờ" cho KTV Loại A này (tại màn hình Quản lý nhân viên).
3. Tại giao diện Chấm công (chưa check-in), kiểm tra xem có nút "Bật Nhận Đơn" không.
4. Bấm bật, nhập số phút. F5 lại trang vẫn phải giữ trạng thái Đang sẵn sàng từ nhà.
5. Bấm "Ngân Hà Xin Chào" để check-in vào ca. Sau khi duyệt xong, KTV vào ca bình thường và cờ nhận đơn ngoài giờ tự động bị gỡ bỏ để tránh xung đột.
