# Kế hoạch Thêm Cấu Hình VIP Menu & Home Spa cho Nhân Viên

Tính năng này cho phép Quản lý cài đặt Nhân viên (KTV) nào được phép hiển thị lên màn hình VIP Menu và KTV nào hỗ trợ dịch vụ Home Spa.

## ⚠️ Đăng nhập Supabase (User Review Required)
> [!IMPORTANT]  
> Vì AI không có quyền can thiệp cấu trúc Bảng của Database (Alter Table), bạn cần copy đoạn mã SQL bên dưới và chạy trong mục **SQL Editor** của trang quản trị Supabase trước khi tôi tiến hành sửa code nhé.

```sql
-- 1. Thêm cột cho phép hiển thị trên VIP Menu
ALTER TABLE "public"."Staff" 
ADD COLUMN IF NOT EXISTS "is_active_vip_menu" boolean DEFAULT false;

-- 2. Thêm cột đánh dấu KTV có đi Home Spa
ALTER TABLE "public"."Staff" 
ADD COLUMN IF NOT EXISTS "is_home_spa" boolean DEFAULT false;
```

## Các File Sẽ Sửa Đổi (Proposed Changes)

---

### Database Schema Document
#### [MODIFY] TableInSupabase.md
- Cập nhật tài liệu cấu trúc bảng `Staff` để thêm mô tả cho 2 cột mới `is_active_vip_menu` và `is_home_spa`.

---

### Admin Employees Module
#### [MODIFY] app/admin/employees/actions.ts
- Cập nhật câu lệnh `select` trong hàm `getEmployees` để lấy dữ liệu 2 cột mới.
- Bổ sung 2 trường này vào Data Payload của hàm `createEmployee` và `updateEmployee`.

#### [MODIFY] app/admin/employees/Employees.logic.ts
- Cập nhật Interface `Employee` (hoặc `Staff`) chứa `is_active_vip_menu` và `is_home_spa`.
- Chỉnh sửa state khởi tạo (Initial Form State) khi bấm "Thêm mới nhân viên" mặc định là `false`.

#### [MODIFY] app/admin/employees/page.tsx
- Thêm 2 nút Toggles (Công tắc Bật/Tắt) hoặc Checkbox vào trong Modal Thêm/Sửa nhân viên.
- (Tùy chọn) Bổ sung 2 huy hiệu (Badge) nhỏ trên danh sách thẻ Nhân viên để nhìn vào là biết ngay ai có VIP, ai có Home Spa.

## Kế hoạch Kiểm tra (Verification Plan)
- Chạy lệnh SQL báo thành công trên Supabase.
- Thử thêm mới 1 nhân viên và bật tính năng VIP Menu -> F5 kiểm tra xem dữ liệu lưu thành công chưa.
- Mở form chỉnh sửa 1 nhân viên cũ -> Tick chọn Home Spa -> Lưu lại và xem kết quả.
