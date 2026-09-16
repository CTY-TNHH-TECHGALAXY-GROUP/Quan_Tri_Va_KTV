# Kế Hoạch Triển Khai: Nâng Cấp Ca Tự Do (Thêm Giờ Về Dự Kiến)

**Trạng thái:** Chờ User duyệt
**Phương án đã chọn:** Phương án 2 (Thêm trường `estimatedEndTime` vào CSDL)

## 🎯 Mục tiêu
- KTV khi điểm danh "Ca tự do" bắt buộc phải nhập giờ về dự kiến.
- Lễ tân nắm bắt được giờ về của KTV tự do ngay trên Dashboard để phân bổ khách chính xác.
- Vá 2 lỗi rủi ro về thời gian (đi muộn sai logic, kẹt check-out) của Ca Tự do hiện tại.

## 🛠 Các bước thực hiện (Roadmap)

### Bước 1: Database Migration & Schema Update
- Cung cấp câu lệnh SQL để chèn thêm cột `estimatedEndTime` (kiểu `text` hoặc `time`) vào bảng `KTVShifts` và `KTVAttendance`.
- Cập nhật tài liệu `TableInSupabase.md` để đồng bộ.

### Bước 2: Cập nhật Backend APIs
- Cập nhật `app/api/ktv/attendance/route.ts`: Nhận tham số `estimatedEndTime` từ FE, insert xuống database `KTVAttendance` và tự động cập nhật sang `KTVShifts`.
- Cập nhật `app/api/ktv/shift/route.ts`: Trả về trường `estimatedEndTime` cho client (đặc biệt là lễ tân).

### Bước 3: Cập nhật Giao diện KTV (Attendance UI)
- Sửa `app/ktv/attendance/page.tsx`: Hiển thị Input chọn giờ (`<input type="time" />`) khi KTV chọn loại ca là `FREE`. Chặn Validation không cho để trống.
- Sửa `app/ktv/attendance/Attendance.logic.ts`:
  - Khai báo state lưu `estimatedEndTime`.
  - Fix 2 bugs logic rủi ro (bypass `isLate = false` và `canCheckOut = true`).
  - Gắn payload `estimatedEndTime` gửi lên POST API.

### Bước 4: Cập nhật Giao diện Lễ Tân (KTV Hub)
- Sửa `app/reception/ktv-hub/page.tsx`: 
  - Tại khu vực vẽ UI "Ca tự do", lấy data `estimatedEndTime` và render thêm 1 dòng text hoặc Badge nhắc nhở nổi bật: `⏰ Dự kiến về: HH:MM`.

---
*Lưu ý: User cần hỗ trợ chạy lệnh SQL ở Bước 1 trong Supabase SQL Editor. AI sẽ chịu trách nhiệm toàn bộ quá trình code các bước còn lại.*
