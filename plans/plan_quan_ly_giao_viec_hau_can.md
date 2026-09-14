# Kế hoạch Xây dựng Module Quản lý Giao Việc & Nghiệm Thu (Hậu Cần)

Dựa trên các tài liệu yêu cầu và hình ảnh thiết kế Dashboard mà User cung cấp, đây là bản kế hoạch chi tiết để nâng cấp toàn diện phân hệ **Hậu Cần (Support)**.

## Quyết định Thiết kế Kỹ thuật (Technical Decisions)
1. **Kiến trúc "Giữ tạm ảnh" (Auto-save/Draft):** Ảnh sẽ được upload **bất đồng bộ ngay lập tức** lên Supabase Storage và lưu vào bảng `TaskPhotos` với cờ `is_submitted = false`. Khi NV bấm "Hoàn thành công việc", hệ thống mới chốt (commit) các ảnh này.
2. **Dọn rác (Garbage Collection):** Cronjob ngầm dọn dẹp các ảnh `is_submitted = false` quá 7 ngày để tránh tốn dung lượng Storage.
3. **Cơ chế lặp lại công việc cố định (Cronjob):** Sử dụng **Supabase `pg_cron`** chạy ngầm định kỳ lúc 00:01 mỗi ngày để quét bảng `TaskTemplates` và tự động sinh ra các `Tasks` mới, gắn chặt với ID của từng `Room`.
4. **Truy vấn Thống kê (Room Activity):** Đếm số lượng `BookingItems` đã hoàn thành và group theo `roomName`. **UI của Dashboard này sẽ được thiết kế dạng Collapsible (Thu gọn/Mở rộng)** để tránh chiếm diện tích, khi Quản lý cần xem mới bấm mở ra.

## Phân Tích Database (Schema Thay Đổi)

Xóa bỏ bảng `SupportAreas` cũ. Từ nay các task Hậu cần sẽ trỏ trực tiếp khóa ngoại `roomId` vào bảng `Rooms` của hệ thống cốt lõi.

Các bảng sẽ tạo mới:
- `TaskCategories` (Hạng mục: Vệ sinh, Bổ sung khăn, Tinh dầu...).
- `TaskTemplates` (Cấu hình việc định kỳ, yêu cầu tối thiểu 1 ảnh).
- `Tasks` (Liên kết với `roomId`, Thêm phân loại việc cố định `FIXED` và việc phát sinh `AD-HOC`).
- `TaskPhotos` (Có cột `is_submitted` để xử lý lưu nháp).
- `TaskReviews` (Lưu lịch sử các lần nghiệm thu).

## Các Giai Đoạn Triển Khai (Execution)

### 1. Tầng Database & Migration
- Cập nhật tài liệu `TableInSupabase.md` cho Nhóm Hậu Cần.
- Viết file SQL Migration tạo 5 bảng mới và xóa bảng cũ (SupportAreas, SupportTasks).

### 2. Tầng API & Service (S.O.L.I.D)
- `lib/support-task.service.ts`: Xử lý giao việc, cập nhật, nghiệm thu.
- `lib/room-stats.service.ts`: Query dữ liệu BookingItems trong ngày để đếm lượt phục vụ từng phòng.
- API Route: `GET /api/support/room-stats`
- API Route: `POST /api/support/tasks/[id]/photos`
- API Route: `POST /api/support/tasks/[id]/status`

### 3. Tầng Frontend (Admin & KTV/Hậu Cần)
- Màn hình Quản lý Danh mục & Mẫu công việc.
- Dashboard Thống Kê Phòng (Dạng Collapse) + Giao việc nóng.
- Màn hình duyệt / nghiệm thu công việc.
- App Nhân viên Hậu Cần: Danh sách việc (Định kỳ vs Đột xuất) + UI Upload ảnh nháp tức thì.
