# Kế hoạch triển khai: Thêm mốc giá tua VIP và Điều trị (180K) cho nhân viên

Tính năng: Bổ sung 2 cài đặt (công tắc/toggle) cho từng nhân viên để áp dụng mốc giá tua 180K khi thực hiện dịch vụ Menu VIP hoặc Menu Điều Trị.

## Phân tích yêu cầu đã chốt
- **Dịch vụ VIP (Mã NHP)**: Áp dụng giá tua 180K cho các dịch vụ có mã chứa `NHP` thuộc Menu VIP.
- **Menu Điều Trị**: Áp dụng giá tua 180K cho dịch vụ thuộc Menu Điều Trị (cần xác nhận thêm mã dịch vụ cụ thể của menu này là gì, ví dụ `NHDT`?).
- **Cấu hình Nhân viên**: Mỗi nhân viên sẽ có 2 công tắc độc lập. Bật công tắc nào thì nhân viên đó mới được tính mức 180K khi làm dịch vụ của menu tương ứng.

> [!IMPORTANT]
> **Câu hỏi chờ xác nhận cuối cùng:** 
> - Mã dịch vụ của **Menu Điều Trị** là gì? (Ví dụ: Các mã có chứa `NHDT` hay cụ thể là mã nào?)

## Đề xuất giải pháp kiến trúc

### 1. Database (Bảng `Staff`)
- Sử dụng cột `feature_flags` (chuẩn kiểu `jsonb`) hiện có của bảng `Staff` để lưu trữ 2 tuỳ chọn này.
- Khai báo thêm 2 keys: 
  - `vip_commission_enabled`: `boolean` (Dành cho mã `NHP`)
  - `treatment_commission_enabled`: `boolean` (Dành cho mã Điều Trị)

### 2. Giao diện quản lý Nhân viên (`app/admin/employees/`)
- Mở rộng giao diện cập nhật Nhân viên (Modal) để hiển thị 2 công tắc (Toggle):
  - [x] Được hưởng giá tua Menu VIP (180K - Mã NHP)
  - [x] Được hưởng giá tua Menu Điều Trị (180K)
- Cập nhật hàm gọi API / Server Action để lưu các giá trị này vào `feature_flags` của nhân viên.

### 3. Logic tính hoa hồng (Supabase SQL Functions)
- Cập nhật 2 hàm cốt lõi tính tiền tua (`get_ktv_wallet_balance` và `get_ktv_wallet_timeline`).
- **Logic cập nhật**:
  - Khi lặp qua từng `BookingItems`, lấy `feature_flags` của nhân viên (`p_staff_id`).
  - Lấy mã dịch vụ (`service_code` - cần join với bảng `Services`).
  - Nếu `vip_commission_enabled = true` VÀ `service_code LIKE '%NHP%'`: Tiền tua = 180,000 VND.
  - Nếu `treatment_commission_enabled = true` VÀ `service_code LIKE '%[MÃ ĐIỀU TRỊ]%'`: Tiền tua = 180,000 VND.
  - Các trường hợp còn lại: Tính theo thời lượng bình thường (`v_milestones` hoặc `v_rate_60`).

---

## Kế hoạch kiểm thử
- **Tạo Booking test**: 1 Booking dịch vụ mã VIP (NHP) và 1 Booking dịch vụ Điều Trị.
- **Test Case 1 (Chưa gạt công tắc)**: KTV thực hiện dịch vụ -> Tính tiền tua theo số phút bình thường.
- **Test Case 2 (Đã gạt công tắc)**: KTV thực hiện dịch vụ -> Ví Tua hiển thị chính xác +180,000 VND, timeline ghi nhận rõ nguồn.
