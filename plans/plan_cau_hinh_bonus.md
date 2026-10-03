# Kế hoạch Triển khai: Cài đặt Cấu hình Bonus & Settings Hệ Thống

## 1. Mục tiêu
Thiết lập hệ thống tiền thưởng (Bonus) tự động cho KTV dựa trên "Ca làm việc" (`KTVShifts`) và "Đánh giá xuất sắc" (`Rating >= 4`). Đồng thời, xây dựng màn hình **Admin System Settings** để quản lý các mốc cấu hình linh hoạt (không hardcode). Việc này kết hợp luôn cấu hình "Tiền cọc KTV".

## 2. Luật tính thưởng (Business Logic đã chốt)
- **Cơ sở tính thưởng:** Tính trên **từng Đơn hàng (Booking)**. Điểm thưởng cơ bản của một KTV phụ thuộc vào **Ca làm việc** hiện tại của họ (`KTVShifts.shiftType`):
  - **Ca 1 (`SHIFT_1`) & Ca 2 (`SHIFT_2`):** Điểm cơ bản là **20 điểm**.
  - **Ca 3 (`SHIFT_3`):** Đặc quyền thưởng cao, Điểm cơ bản là **40 điểm**.
  
- **Thuật toán Chia điểm & Giới hạn (Capping):**
  1. **Xét từng Dịch vụ (BookingItem):** Dịch vụ phải có đánh giá "Xuất sắc" (`itemRating >= 4`).
  2. **Chia điểm theo Dịch vụ:** 
     - Nếu 1 Dịch vụ do 1 KTV làm: KTV nhận đủ Điểm cơ bản (Ví dụ: 20đ).
     - Nếu 1 Dịch vụ do 2 KTV cùng làm: Điểm cơ bản được chia đều (Ví dụ: mỗi người 10đ).
  3. **Giới hạn (Max/Booking):** Tổng điểm thưởng của 1 KTV thu được từ tất cả các Dịch vụ trong cùng 1 Đơn hàng sẽ **KHÔNG VƯỢT QUÁ Điểm cơ bản của Ca đó**.
     - *Ví dụ 1 (1 đơn, 2 DV, 2 KTV):* KTV A làm DV1 được 20đ, KTV B làm DV2 được 20đ. Cả hai vẫn nhận đủ 20đ.
     - *Ví dụ 2 (1 đơn, 1 DV, 2 KTV):* KTV A và B làm chung 1 DV. Mỗi người nhận 10đ.
     - *Ví dụ 3 (1 đơn, 2 DV, 1 KTV làm hết):* KTV A làm DV1 (20đ) + DV2 (20đ) = 40đ. Nhưng do luật "Max", KTV A chỉ nhận tối đa 20đ cho đơn hàng này.

## 3. Chi tiết Cấu hình Database (`SystemConfigs`)
Thêm các biến JSON vào bảng `SystemConfigs` để quản trị có thể thay đổi sau này:
- `ktv_bonus_rate`: Tỷ lệ quy đổi (Ví dụ: 1000 - tức là 1 điểm = 1000 VNĐ).
- `ktv_shift_1_bonus`: Điểm thưởng cho Ca 1 (Mặc định: 20).
- `ktv_shift_2_bonus`: Điểm thưởng cho Ca 2 (Mặc định: 20).
- `ktv_shift_3_bonus`: Điểm thưởng cho Ca 3 (Mặc định: 40).

## 4. Các bước triển khai (Implementation Steps)

### Bước 1: Khởi tạo dữ liệu Database (SQL Migration)
- Tạo file SQL migration để `INSERT` các biến cấu hình mặc định (nêu trên) vào bảng `SystemConfigs`.

### Bước 2: Xây dựng API Quản lý Cấu hình (Backend)
- Tạo API route: `app/api/admin/settings/system/route.ts`.
- **GET**: Trả về toàn bộ danh sách các cấu hình trong `SystemConfigs`.
- **PATCH / POST**: Cập nhật giá trị của một hoặc nhiều cấu hình cùng lúc (Auth Admin).

### Bước 3: Tạo giao diện Admin Settings (Frontend)
- Tạo trang quản trị: `app/admin/settings/system/page.tsx`.
- Thiết kế UI dạng Form (Tailwind CSS) gồm:
  - **Tài chính & Hoa hồng**: Field "Tiền cọc duy trì" (từ plan trước).
  - **Cấu hình Điểm Thưởng (Bonus)**: Field `Tỷ lệ quy đổi (VNĐ)`, Mốc điểm thưởng `Ca 1`, `Ca 2`, `Ca 3`.

### Bước 4: Cập nhật Logic tính Tiền / Lịch sử KTV (Backend)
- Sửa lại API `app/api/ktv/history/route.ts` (và `ktv-summary/route.ts` nếu cần):
  - Truy vấn bổ sung bảng `KTVShifts` để biết `shiftType` đang Active của từng nhân viên.
  - Xóa dòng hardcode `Math.round(25 / numTechs)` hiện tại.
  - Thay bằng Logic mới: Kiểm tra Ca -> Lấy điểm cấu hình (20đ hoặc 40đ) -> Kiểm tra Rating >= 4 -> Chia đều `numTechs`.
