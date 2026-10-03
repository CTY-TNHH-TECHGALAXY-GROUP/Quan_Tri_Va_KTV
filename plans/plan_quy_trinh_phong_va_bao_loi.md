# Plan: Tuỳ chỉnh Quy trình phòng & Báo sự cố phòng

**Trạng thái**: ✅ Đã duyệt (2026-04-13)

## Mục tiêu
- Mỗi phòng có danh sách quy trình Mở phòng (`prep_procedure`) và Dọn dẹp (`clean_procedure`) riêng.
- KTV có nút Báo sự cố phòng (gửi EMERGENCY notification về Lễ tân).

## Thay đổi

### 1. Database (Supabase)
- Thêm 2 cột `prep_procedure` (jsonb) và `clean_procedure` (jsonb) vào bảng `Rooms`.

### 2. Backend API
- `GET /api/ktv/booking`: Join lấy `prep_procedure`, `clean_procedure` từ `Rooms`.

### 3. Frontend (KTV Dashboard)
- `KTVDashboard.logic.ts`: Chuyển checklist sang dynamic array, thêm state báo sự cố.
- `page.tsx`: Render checklist từ API, thêm nút + modal Báo sự cố phòng.
