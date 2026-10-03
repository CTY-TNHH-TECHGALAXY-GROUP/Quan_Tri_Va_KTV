# Kế Hoạch Cải Thiện Chức Năng Ảnh Điểm Danh KTV

Mục tiêu:
1. Cho phép KTV upload nhiều ảnh cùng lúc bằng cách chọn một lượt, và tăng giới hạn số lượng ảnh (đề xuất 5 hoặc 10).
2. Quầy Lễ Tân có thể xem được tất cả các ảnh KTV đã upload thay vì chỉ 1 ảnh đầu tiên.
3. Setup cơ chế tự động xoá ảnh điểm danh sau 7 ngày trên Supabase Storage để tiết kiệm dung lượng.

## User Review Required

> [!IMPORTANT]
> **Giới hạn số lượng ảnh:** Tôi đề xuất tăng `MAX_PHOTOS` từ 3 lên **5 ảnh** cho mỗi lần điểm danh để đảm bảo không bị quá tải lưu trữ hoặc quá trình tải quá lâu do file nặng. Bạn thấy 5 ảnh đã phù hợp chưa, hay muốn số lượng khác?
> 
> **Giao diện xem ảnh ở Quầy Lễ Tân:** Hiện tại quầy chỉ có 1 nút "Xem ảnh" nhỏ xíu. Khi có nhiều ảnh, tôi sẽ làm một Modal (cửa sổ popup) khi bấm vào "Xem ảnh" sẽ mở ra để xem tuần tự các ảnh (hoặc hiện ra 1 danh sách các nút Ảnh 1, Ảnh 2...). Bạn thích cách mở popup Modal hơn hay chỉ cần bung ra nhiều nút link hơn? (Tôi đề xuất làm Modal xem ảnh để UI sang trọng và chuyên nghiệp hơn).

## Proposed Changes

---

### Frontend Components

#### [MODIFY] `app/ktv/attendance/page.tsx`
- Sửa `<input type="file" ... />` thêm thuộc tính `multiple` để KTV có thể bôi đen / chọn một lúc nhiều ảnh từ thư viện.
- Sửa hàm `handleCapture` để xử lý vòng lặp nén nhiều ảnh cùng lúc thay vì chỉ lấy `files[0]`.
- Nâng hằng số `MAX_PHOTOS = 5` (hoặc tuỳ chỉnh theo ý bạn).
- Bổ sung UI loading nhẹ nếu đang nén nhiều ảnh cùng lúc.

#### [MODIFY] `app/reception/ktv-hub/page.tsx`
- Ở các khu vực `AttendancePendingSection` và `AttendanceHistorySection`:
  - Thay vì chỉ render `p[0]` thành link `href`, sẽ làm chức năng khi click vào nút "Xem ảnh" sẽ hiện lên **Modal Image Viewer**.
  - Modal này sẽ cho phép bấm qua lại giữa các ảnh (nếu có 3 ảnh thì xem được cả 3).

---

### Database / Backend

#### [NEW] `supabase/migrations/20260424000000_auto_cleanup_attendance_photos.sql`
- Tạo script bằng SQL cho Supabase:
  - Bật extension `pg_cron`.
  - Khai báo một PostgreSQL Function để quét trong bảng `storage.objects` (nơi lưu file thật của Supabase), tìm các object thuộc bucket `attendance` có thời gian tạo (`created_at`) cũ hơn 7 ngày và gọi API xóa của Storage (nếu có) hoặc xóa row.
  - Thiết lập 1 Cron Job chạy tự động lúc 03:00 sáng mỗi ngày.

## Verification Plan

### Automated / Manual Tests
- **KTV View:** Dùng thiết bị di động truy cập vào Chấm Công, bấm vào khu vực chọn ảnh, thử chọn nhiều hơn 1 ảnh (ví dụ 3 ảnh) cùng lúc. Kiểm tra giao diện hiển thị ảnh thu nhỏ sau khi chọn.
- **Reception View:** Vào trang KTV Hub của lễ tân, tìm lượt điểm danh có nhiều ảnh, bấm "Xem ảnh" và chuyển qua lại các ảnh.
- **Supabase Auto Delete:** Chạy trực tiếp Function dọn dẹp trong SQL Editor của Supabase để test, kiểm tra `storage.objects` xem file cũ có bị xoá đi đúng không.
