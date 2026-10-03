# Kế hoạch: Thêm nút Chọn tất cả trên KTV Dashboard

## Mục tiêu
Thêm nút **"Chọn tất cả"** (Select All) vào 2 màn hình trên KTV Dashboard:
1. Quy trình chuẩn bị phòng (`Checklist`)
2. Quy trình dọn dẹp phòng (`HandoverChecklist`)

## Các thay đổi dự kiến
### 1. File xử lý logic: `app/ktv/dashboard/KTVDashboard.logic.ts`
- Thêm function `checkAllChecklist()` để bật tất cả cờ `ac, towel, oil, bed, toilet` = `true`.
- Thêm function `checkAllHandoverChecklist()` để bật tất cả cờ `laundry, clean, reset, scent` = `true`.
- Xuất khẩu (export) 2 functions này ra để bên ngoài sử dụng.

### 2. File UI: `app/ktv/dashboard/page.tsx`
- **ScreenDashboard**: Tìm khối giao diện `Quy trình chuẩn bị` và chèn nút "Chọn tất cả" bên cạnh tiêu đề (hoặc góc phải). Gọi hàm `checkAllChecklist()`.
- **ScreenHandover**: Tìm khối giao diện `Dọn dẹp phòng` và chèn nút "Chọn tất cả" bên trên danh sách các mục dọn dẹp. Gọi hàm `checkAllHandoverChecklist()`.

## Phong cách UI
- Sử dụng màu xanh ngọc đồng bộ với màn hình `ScreenDashboard` (VD: `text-emerald-600 bg-emerald-50`).
- Sử dụng màu xanh dương đồng bộ với màn hình `ScreenHandover` (VD: `text-blue-600 bg-blue-50`).
- Căn lề thống nhất, font chữ in hoa vừa vặn với phong cách app.

## Trạng thái thực hiện
- Đã hoàn tất và viết log vào `coordination.md`.
