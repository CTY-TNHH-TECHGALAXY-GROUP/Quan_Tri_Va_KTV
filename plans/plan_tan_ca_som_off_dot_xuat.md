# Kế hoạch triển khai: Xử lý KTV Tan Ca Sớm (Nghỉ Đột Xuất)

## 1. Vấn đề hiện tại
- Nút "Tan ca" hiện tại có cảnh báo "Bạn chưa tới giờ tan ca... Bạn có chắc chắn muốn tan ca SỚM không?" nhưng không lưu vết lỗi vi phạm.
- Yêu cầu mới: Khi KTV tan ca trước giờ làm chuẩn, đổi câu cảnh báo thành "Bạn tan ca trước giờ làm sẽ tính off đột xuất, bạn có chắc chắn không?".
- Khi đồng ý, hệ thống cần ghi nhận hành động này là "OFF đột xuất" và lưu vào danh sách Lịch OFF (`KTVLeaveRequests`) để sau này bên quản lý lương (Payroll) có căn cứ trừ tiền.

## 2. Giải pháp kỹ thuật

### 2.1. Cập nhật Frontend (UI) `app/ktv/attendance/page.tsx`
- Sửa đổi logic ở nút **TAN CA**:
  - Nếu `!canCheckOut && checkoutBlockedUntil` (Chưa tới giờ tan ca):
    - Đổi nội dung `window.confirm` thành: `"Bạn tan ca trước giờ làm sẽ tính off đột xuất, bạn có chắc chắn không?"`.
    - Khi KTV bấm Đồng ý:
      - Vẫn mở popup `CHECK_OUT` để yêu cầu KTV chụp ảnh tan ca (như luồng hiện tại để có bằng chứng check-out).
      - Tuy nhiên, truyền ngầm thêm một thông tin `selectedShiftType = 'SUDDEN_OFF_CHECKOUT'` để đánh dấu hành động là tan ca đột xuất.
- Trong `handleSubmitForm`: Sẽ gán cờ `SUDDEN_OFF_CHECKOUT` vào biến `selectedShiftType` khi gọi hàm API `handleAttendance('CHECK_OUT')`.

### 2.2. Cập nhật Backend API `app/api/ktv/attendance/route.ts`
- Bổ sung logic khi nhận điểm danh:
  - Nếu `checkType === 'CHECK_OUT'` VÀ `selectedShiftType === 'SUDDEN_OFF_CHECKOUT'` (Tan ca sớm đột xuất).
  - Hoặc `checkType === 'SUDDEN_OFF'` (KTV chọn chức năng Nghỉ đột xuất nguyên ngày ngay lúc check-in đầu ca).
- **Hành động lưu DB**:
  - Tạo một bản ghi mới trong bảng `KTVLeaveRequests` để đưa KTV này vào "Lịch OFF" (giao diện hình 2).
  - **Data Schema Chuẩn (Dựa theo DB):** `employeeId`, `employeeName`, `date` (Tính theo Business Date), `status: 'APPROVED'`, `is_sudden_off: true`, `is_extension: false`, `reason: 'Tan ca sớm (Nghỉ đột xuất)'`.
- Cập nhật thông báo hệ thống (Notification) rõ ràng là KTV vừa **Tan ca sớm (Nghỉ đột xuất)** để Admin nắm bắt.

## 3. Các thành phần ảnh hưởng
- `app/ktv/attendance/page.tsx`
- `app/api/ktv/attendance/route.ts`
- Giao diện Admin -> KTV Hub -> Lịch OFF: Hệ thống sẽ tự động hiển thị bản ghi của KTV ở tab Lịch OFF do bảng `KTVLeaveRequests` được thêm dữ liệu mới. (Lưu ý: Bản ghi này sẽ hiển thị nằm đúng vào cái ngày (Business Date) mà KTV đó bấm tan sớm, giúp Admin tra cứu chính xác không bị lệch ngày).
- Hệ thống Payroll:
  - Cần thống kê đối soát chính xác số lượng **Nghỉ đột xuất** (`is_sudden_off = true`), **Nghỉ có phép** (`is_sudden_off = false` và `status = APPROVED`), và thời gian Check-in/Check-out thực tế để phục vụ cho việc chấm công và tính lương/phạt sau này.

## 4. Rủi ro / Chú ý
- **Tính toán Business Date chính xác (Rất Quan Trọng):** Dù Spa có ca muộn nhất chỉ đến 12h đêm, ta vẫn luôn phải tính toán Ngày làm việc (Business Date) thông qua hàm `dayCutoffHours` (đã có sẵn trong `/api/ktv/attendance/route.ts`) để gán đúng `date` cho bảng `KTVLeaveRequests`, tránh những sai lệch do dùng `new Date()` một cách máy móc. Thường nghỉ đột xuất (tan ca sớm) sẽ được chốt theo đúng ngày của ca làm việc hiện tại.
