# Kế Hoạch Triển Khai: Ví Tích Lũy (Piggy Bank)

Căn cứ theo yêu cầu và phê duyệt của bạn, đây là bản kế hoạch CHÍNH THỨC đã chốt để tiến hành code.

## 1. Mục Tiêu & Chức Năng Cốt Lõi
- **Mục tiêu:** KTV có một khoản tiết kiệm/tích lũy đều đặn. 
- **Đối tượng:** KTV có cờ `enable_piggy_wallet = true` (VD: NH079).
- **Cơ chế nạp:** Mỗi tuần hệ thống TỰ ĐỘNG KHẤU TRỪ tiền từ **Ví Tua** chuyển sang **Ví Tích Lũy**.
- **Cơ chế rút:** CHỈ ĐỂ QUAN SÁT. Không cho phép yêu cầu rút tiền sớm trước khi đủ tổng số tuần.

## 2. Thiết Kế Database (Supabase)

### Bảng `KTVPiggyBank` (Thông tin tích lũy của từng KTV)
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | uuid | Khóa chính |
| `staff_id` | text | Mã KTV (VD: NH079) |
| `weekly_amount` | numeric | Số tiền trừ mỗi tuần (ví dụ: 500,000) |
| `contributed_weeks` | integer | Số tuần đã đóng |
| `status` | text | `ACTIVE`, `COMPLETED`, `CANCELLED` |

### Bảng `KTVPiggyBankLedger` (Lịch sử giao dịch)
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | uuid | Khóa chính |
| `staff_id` | text | Mã KTV |
| `amount` | numeric | Số tiền (+ / -) |
| `type` | text | `DEPOSIT` (từ ví tua) |
| `note` | text | Ghi chú (VD: "Đóng tích lũy tuần 1") |
| `created_at` | timestamptz | Thời điểm giao dịch |

### Cấu hình `SystemConfigs`
- Thêm `ktv_piggy_bank_total_weeks` (VD: 50 tuần) - Tổng số tuần cần đóng.

## 3. Kiến Trúc Tự Động Hóa (CronJob)
**Yêu cầu:** Tự động trừ tiền vào cuối tuần.
- **Thực thi:** Tạo route Next.js API `/api/cron/piggy-bank-deduct`.
- **Lịch trình (Vercel Cron):** Đăng ký vào `vercel.json` lịch chạy là `0 19 * * 0` (tức 19h00 UTC ngày Chủ Nhật, tương đương 02h00 sáng Thứ Hai giờ Việt Nam).
- **Luồng xử lý (Service Layer):**
  1. Lấy danh sách KTV đang `ACTIVE` trong `KTVPiggyBank`.
  2. Bỏ qua nếu `contributed_weeks` >= `ktv_piggy_bank_total_weeks`.
  3. Mở một giao dịch (hoặc chạy batch an toàn):
     - Insert vào `WalletAdjustments` số tiền âm (`-weekly_amount`) với reason "Trừ tiền ví tích lũy hàng tuần".
     - Insert vào `KTVPiggyBankLedger` số tiền dương (`+weekly_amount`) type `DEPOSIT`.
     - Update `KTVPiggyBank` tăng `contributed_weeks = contributed_weeks + 1`.
     - Nếu `contributed_weeks` đạt mức tổng, đổi `status = COMPLETED`.
     - Gửi Push Notification (StaffNotifications) cho KTV báo "Bạn vừa hoàn thành tích lũy tuần X".

## 4. Kiến Trúc Frontend

### A. Giao diện Admin (`/admin/finance`)
- **Vị trí:** Tích hợp thành một tab hoặc một page con tại `/admin/finance/piggy-bank`.
- **Giao diện:** Dùng Tailwind, Card, Table chuẩn của project.
- **Chức năng:** Xem danh sách thành viên tích lũy, cài đặt/chỉnh sửa nhanh cột `weekly_amount`.

### B. Giao diện KTV Hub (`app/ktv/wallet`)
- **Vị trí:** Tab `TICH_LUY`.
- **Giao diện:** Glassmorphism, bo góc chuẩn spa.
- **Dữ liệu hiển thị:**
  - Card hiển thị Tổng số tiền.
  - Progress bar (Số tuần đã đóng / Tổng số tuần).
  - List các giao dịch trong `KTVPiggyBankLedger` bên dưới.
- KHÔNG có nút Rút Tiền (ẩn hoàn toàn do chính sách "chỉ quan sát").
