# Bản Vẽ Kỹ Thuật (Final Plan): Phân Hệ Hậu Cần (Support Role)

Bản kế hoạch này mô tả kiến trúc và các bước triển khai chi tiết cho vai trò Hậu Cần (SUPPORT), tập trung vào 3 tính năng cốt lõi: Điểm danh, Bàn giao phòng (chụp ảnh) và Checklist công việc từ Admin.

> [!IMPORTANT]
> **Trạng thái:** ĐÃ CHỐT YÊU CẦU ✅. Bạn có thể mở CMD/Window khác để bắt tay vào triển khai theo từng Giai đoạn bên dưới.

## 1. Phân Tích Yêu Cầu Đã Chốt
1. **Điểm danh:** Nhân viên Hậu cần vẫn sử dụng tính năng Chấm công (Điểm danh) bình thường như KTV, nhưng không bị trừ tiền đi muộn (20k).
2. **Giao diện riêng:** Tạo một trang chuyên biệt `/support/dashboard` cực kỳ tinh gọn dành riêng cho Hậu cần.
3. **Bàn giao phòng:** Khi Booking sang trạng thái `CLEANING`, Hậu cần sẽ thấy phòng đó, tiến hành dọn, chụp ảnh/upload ảnh báo cáo và hệ thống đổi trạng thái thành `DONE`.
4. **Checklist Công việc:** Admin tạo sẵn các đầu việc mẫu. Hằng ngày Admin tick chọn việc mẫu -> chọn tên nhân viên Hậu cần -> Gửi. Nhân viên làm xong bắt buộc phải **chụp ảnh hoặc upload ảnh** minh chứng.

## 2. Database Schema (Các bảng cần tạo thêm)

### Bảng 1: `SupportTaskTemplates` (Danh mục việc mẫu)
| Cột | Kiểu | Ghi chú |
|-----|------|---------|
| `id` | uuid (PK) | Mã việc mẫu |
| `task_name` | text | Tên công việc (VD: Dọn rác) |
| `created_at` | timestamptz | |

### Bảng 2: `SupportAreas` (Khu vực)
| Cột | Kiểu | Ghi chú |
|-----|------|---------|
| `id` | uuid (PK) | Mã khu vực |
| `area_name` | text | Tên khu vực (VD: Tầng 1) |

### Bảng 3: `SupportTasks` (Nhật ký công việc đã giao)
| Cột | Kiểu | Ghi chú |
|-----|------|---------|
| `id` | uuid (PK) | |
| `task_id` | uuid (FK) | Liên kết tới `SupportTaskTemplates` |
| `task_name` | text | Tên công việc (copy ra để dễ query) |
| `assignee_id` | text (FK)| Mã NV Hậu cần được giao |
| `area_id` | uuid (FK) | Khu vực |
| `status` | text | `PENDING`, `DONE` |
| `photo_url` | text | Ảnh minh chứng (Bắt buộc khi DONE) |
| `created_by` | text | Admin ID |
| `created_at` | timestamptz| |
| `completed_at`| timestamptz| |

## 3. Kế Hoạch Triển Khai (Execution Steps cho "Thợ Xây")

### Giai đoạn 1: Khởi tạo Database & API (Backend)
1. **[NEW] SQL Migration:** Tạo file `.sql` trong `supabase/migrations/` để khởi tạo 3 bảng trên (cấp quyền RLS cho phép Support/Admin đọc ghi). Cập nhật file `TableInSupabase.md`.
2. **[NEW] Route API:** Tạo thư mục `app/api/support/tasks/route.ts` để xử lý các hành động:
   - GET: Lấy danh sách task mẫu, khu vực, và task đã giao.
   - POST: Admin gán task cho nhân viên.
   - PATCH: Hậu cần submit ảnh và update `status = DONE`.
3. **[MODIFY] API Bookings:** Mở rộng logic (hoặc tạo action riêng) để xử lý việc update booking từ `CLEANING` -> `DONE` kèm upload `photoUrl`.

### Giai đoạn 2: Phát triển App Hậu Cần (Frontend)
1. **[MODIFY] Middleware & Routing:** 
   - Đảm bảo role `SUPPORT` được phép truy cập `/ktv/attendance` (để điểm danh).
   - Đảm bảo Sidebar chỉ hiện menu Điểm danh và Dashboard Hậu Cần cho họ. Nếu họ đăng nhập, redirect về `/support/dashboard`.
2. **[NEW] Support Dashboard (`app/support/dashboard/page.tsx`):**
   - **Tab 1: Bàn giao phòng:** Fetch các Booking đang có status `CLEANING`. Hiển thị thành danh sách thẻ. Tích hợp tính năng mở Camera hoặc chọn ảnh từ thư viện để hoàn tất dọn phòng.
   - **Tab 2: Checklist công việc:** Fetch danh sách `SupportTasks` (status = PENDING, assignee_id = user hiện tại). Nút "Hoàn tất" sẽ bắt buộc gọi popup Camera/Upload để lấy minh chứng.

### Giai đoạn 3: Phát triển Màn hình Admin (Frontend)
1. **[NEW] Giao việc Hậu Cần (`app/admin/support-tasks/page.tsx`):**
   - **Phần Cấu hình:** Quản lý danh sách Task Templates và Areas (Thêm/Sửa/Xóa).
   - **Phần Giao việc:** Giao diện cho phép tích chọn nhiều Task, chọn Khu vực, chọn Nhân viên Hậu cần cụ thể và bấm "Giao việc".
   - **Phần Theo dõi:** Bảng grid giám sát các task đã giao trong ngày (Ai đã làm xong, xem ảnh chụp báo cáo, ai chưa làm). Thêm tính năng này vào `MODULES` (Sidebar).

> **Nhắc nhở Executor (Người thi công):** Vui lòng hoàn thành dứt điểm từng Giai đoạn, test kỹ rồi mới chuyển sang Giai đoạn tiếp theo. Bắt buộc cập nhật file `coordination.md` khi vào code để tránh đụng file.
