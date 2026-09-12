# Kế hoạch Triển khai: Quản lý Cấu hình Tiền Cọc KTV bằng SystemConfigs

## 1. Phân tích hiện trạng
- **Thực tế:** Hiện tại `app/api/ktv/wallet/balance/route.ts` và `timeline/route.ts` đã được viết code để tự động kéo biến `ktv_min_deposit` từ bảng `SystemConfigs`.
- **Vấn đề 1 (Key mismatch):** Trong database, key đang được lưu dưới dạng IN HOA là `KTV_MINIMUM_DEPOSIT`, trong khi API lại tìm bằng chữ thường `ktv_min_deposit`. Do không khớp nên API luôn bị fallback về con số mặc định 500,000đ trong code.
- **Vấn đề 2 (Thiếu UI):** Quản lý hiện tại không có một màn hình (Giao diện) nào để vào sửa con số này, mà phải vào tận trong Supabase SQL để gõ mã.

## 2. Mục tiêu
Cho phép người quản trị thay đổi con số Tiền cọc (Min Deposit), Mốc tiền tua (Commission per 60 mins),... trực tiếp từ màn hình Admin mà không cần dev can thiệp. Mọi thay đổi sẽ lập tức áp dụng cho toàn bộ KTV.

## 3. Các bước triển khai

### Bước 1: Đồng bộ hóa Key Database & API (Backend)
- Chạy một lệnh SQL/Update API nhỏ để đổi tên key từ `KTV_MINIMUM_DEPOSIT` thành `ktv_min_deposit` cho chuẩn định dạng snake_case của toàn hệ thống.
- Cập nhật lại các API `timeline/route.ts` và `balance/route.ts` để chắc chắn đọc đúng key này, và ép kiểu (parse) cẩn thận sang dạng Số (Number).

### Bước 2: Xây dựng API Quản lý Cấu hình (Backend)
- Tạo API route mới: `app/api/admin/settings/system/route.ts` (GET, POST).
- **GET:** Lấy danh sách các config liên quan đến Tài chính/KTV (`ktv_min_deposit`, `ktv_commission_per_60min`).
- **POST:** Cập nhật giá trị mới (Update) vào bảng `SystemConfigs`. Yêu cầu Auth Role là Admin.

### Bước 3: Tạo màn hình Admin System Settings (Frontend)
- Tạo một page mới: `app/admin/settings/system/page.tsx` (Hoặc nếu hệ thống đã có sẵn 1 trang cài đặt chung, sẽ tích hợp thẳng vào đó).
- **Giao diện:** 
  - Giao diện dạng form hiện đại, phân chia theo các mục như "Cấu hình Tài Chính".
  - Thêm một ô input **"Tiền cọc duy trì KTV"** hiển thị số VNĐ.
  - Khi thay đổi và bấm "Lưu", gọi API ở Bước 2 để lưu vào DB.

### Bước 4: Kiểm tra (Testing)
- Truy cập màn hình Admin, đổi tiền cọc từ 500k -> 1,000,000đ.
- Mở App KTV, kiểm tra xem "Số dư khả dụng" ở Ví KTV có lập tức trừ đi 1 củ thay vì 500k như trước hay không.
- Kiểm tra Lịch sử xem số dư (Running Balance) có bắt đầu ở mốc -1,000,000đ hay không.
