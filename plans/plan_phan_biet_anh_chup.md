# Kế Hoạch Triển Khai: Phân biệt Ảnh Chụp Trực Tiếp và Ảnh Tải Lên

## Mục tiêu
Phân biệt nguồn gốc ảnh điểm danh của KTV:
- Chụp trực tiếp từ giao diện Camera WebRTC của web (isLiveCapture = true).
- Tải ảnh lên từ bộ sưu tập/camera dự phòng (isLiveCapture = false).

Từ đó hiển thị cảnh báo tương ứng trên màn hình "Duyệt điểm danh" của Lễ tân/Admin. KTV sẽ không nhìn thấy cờ (flag) này.

## Chi tiết thay đổi

### 1. Database (Supabase)
- Thêm cột `is_live_capture` (kiểu boolean, mặc định `true`) vào bảng `KTVAttendance`.
- Cập nhật file `TableInSupabase.md` để đồng bộ Schema Reference.

### 2. Sửa Schema (lib/schemas/ktv.schema.ts)
- Bổ sung trường `isLiveCapture: z.boolean().optional().default(false)` vào `AttendanceSchema`.

### 3. Sửa Frontend KTV (Gửi dữ liệu)
- **`app/ktv/attendance/Attendance.logic.ts`**: Thêm tham số `isLiveCapture?: boolean` vào hàm `handleAttendance` và đưa vào payload gửi đi.
- **`app/ktv/attendance/page.tsx`**:
  - Truyền `isLiveCapture = true` nếu KTV dùng hàm `captureFromVideo` (Camera WebRTC).
  - Truyền `isLiveCapture = false` nếu KTV dùng thẻ `<input type="file">` dự phòng.

### 4. Sửa Backend API (Nhận & Trả dữ liệu)
- **`app/api/ktv/attendance/route.ts`**: Nhận trường `isLiveCapture` từ body và insert/map vào cột `is_live_capture` trong Supabase.
- **`app/api/ktv/attendance/pending/route.ts`** & **`app/api/ktv/attendance/history/route.ts`**: Cập nhật query `.select(...)` để lấy thêm trường `is_live_capture` trả về cho Frontend Lễ tân.

### 5. Sửa Frontend Lễ Tân / Admin (Hiển thị cảnh báo)
- **`app/reception/ktv-hub/page.tsx`**: 
  - Tại component `AttendancePendingSection` (Duyệt điểm danh) và `AttendanceHistorySection` (Lịch sử điểm danh): Bổ sung UI badge.
  - Nếu `is_live_capture === true`: Hiện nhãn xanh 🟢 `Chụp trực tiếp`.
  - Nếu `is_live_capture === false`: Hiện nhãn đỏ 🔴 `Tải ảnh lên`.

## Kế hoạch kiểm thử (Verification Plan)
- KTV vào thử điểm danh bằng WebRTC Camera -> Xem phía Lễ tân có hiện "Chụp trực tiếp" không.
- KTV dùng tính năng tải ảnh dự phòng -> Xem phía Lễ tân có hiện "Tải ảnh lên" (màu đỏ) không.
- Đảm bảo KTV không nhìn thấy trạng thái này trên màn hình của họ.

---

> **Lưu ý User**: Xin vui lòng xác nhận "Đồng ý" hoặc "Duyệt" để em bắt đầu tiến hành triển khai sửa code.
