# Tính năng: Đăng ký làm thêm giờ khi Tan ca

Bản kế hoạch triển khai cho yêu cầu thêm tính năng hỏi KTV có muốn làm thêm giờ không khi họ bấm nút "Tan ca", và cập nhật hiển thị lên bảng điều khiển của quản lý.
- Đã xác nhận: Chỉ áp dụng hỏi làm thêm cho các ca cố định: Ca 1, Ca 2, Ca 3.

## Các thay đổi thực hiện

### 1. Frontend KTV (`app/ktv/attendance/page.tsx` & `Attendance.logic.ts`)
- **UI Modal mới:** Thêm một state `isOvertimePromptOpen`. Khi bấm "Ngân Hà Xin Cảm ơn", nếu có thể tan ca và KTV đang thuộc Ca 1, 2, 3:
  - Hiển thị Modal: "Bạn có muốn làm thêm giờ không?"
  - Nút 1: "Không, tan ca bình thường" -> chuyển sang form CHECK_OUT gốc.
  - Nút 2: "Có, làm thêm" -> Hiện ô chọn thời gian (time picker) nhập "Giờ kết thúc làm thêm".
- **Logic:** Khi submit "Làm thêm", gọi API `handleAttendance` với tham số `checkType: 'OVERTIME'` cùng giá trị `estimatedEndTime`.
- **Cập nhật UI Check-in (CONFIRMED):** Hiển thị giờ kết thúc làm thêm trên màn hình chính cho các ca 1, 2, 3 có làm thêm.

### 2. Backend API (`app/api/ktv/attendance/route.ts` & `status/route.ts`)
- **route.ts:**
  - Bổ sung luồng xử lý riêng cho `checkType === 'OVERTIME'`.
  - Cập nhật `KTVShifts`: Tìm record đang `ACTIVE` của KTV này và gán `estimatedEndTime` = thời gian mới.
  - Ghi Log `KTVAttendance` với type là `OVERTIME` để lưu vết lịch sử và hiển thị trên lịch sử điểm danh.
  - Gửi Notification tới quản lý: `📍 KTV A đăng ký làm thêm giờ đến [HH:mm]`.
  - Giữ nguyên `isOnShift` của User là `true`.
- **status/route.ts:**
  - Bổ sung `OVERTIME` vào hàm lọc `confirmedCheckIn` để hệ thống vẫn ghi nhận KTV đang làm việc (trạng thái `CONFIRMED`) sau khi đăng ký làm thêm.

### 3. Frontend Quản lý (`app/reception/ktv-hub/page.tsx`)
- Sửa lại block code hiển thị thông tin ca làm việc dưới tên KTV.
- Cập nhật điều kiện để hiển thị badge `"Làm thêm (Đến: HH:mm)"` nếu thuộc ca cố định và có `estimatedEndTime`. Ca tự do vẫn hiển thị `"Tự do (Về: HH:mm)"` như cũ.
