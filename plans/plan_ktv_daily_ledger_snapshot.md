# Kế Hoạch Triển Khai: KTV Daily Ledger Snapshot (Ví Điện Tử Doanh Nghiệp)

## Mục tiêu
Chuyển đổi kiến trúc tính toán tiền tua KTV từ Real-time toàn phần sang mô hình Sổ Cái Hàng Ngày (Daily Ledger). Giúp hệ thống hoạt động siêu nhanh khi dữ liệu đạt hàng triệu đơn hàng, đồng thời giải quyết bài toán sai lệch khi có cập nhật, sửa đổi.
**Lưu ý quan trọng:** Tiền Tip chỉ để xem thống kê, KHÔNG cộng vào `gross_income` (Số dư khả dụng).

## Phase 1: Chuẩn bị Cơ sở dữ liệu (Supabase)
1. **Tạo bảng `KTVDailyLedger`**:
   - `id` (uuid, PK)
   - `date` (date): Ngày chốt sổ
   - `staff_id` (text): Mã KTV
   - `total_commission` (numeric): Tổng tiền tua trong ngày
   - `total_tip` (numeric): Tổng tiền tip trong ngày (Chỉ để xem)
   - `total_adjustment` (numeric): Các khoản phạt/thưởng trong ngày
   - `total_withdrawn` (numeric): Tiền mặt đã rút trong ngày
   - `created_at` / `updated_at`
   - *Constraint*: `UNIQUE(date, staff_id)` để đảm bảo mỗi KTV chỉ có 1 dòng duy nhất mỗi ngày.

## Phase 2: Viết thuật toán chốt sổ (Snapshot Generator)
1. Tạo API nội bộ `POST /api/cron/sync-daily-ledger`.
2. Logic của API này:
   - Nhận vào tham số `targetDate` (Ngày cần chốt sổ).
   - Quét toàn bộ `Bookings`, `WalletAdjustments`, `KTVWithdrawals` của đúng ngày đó.
   - Chạy thuật toán Javascript chuẩn (đang dùng ở Sổ Tua) để nội suy hoa hồng.
   - Thực hiện lệnh `UPSERT` (Insert hoặc Update) vào bảng `KTVDailyLedger`.
   - Bất cứ khi nào Lễ tân sửa lại Bill của ngày cũ, Admin chỉ việc gọi API này truyền vào ngày bị sửa để hệ thống tự động đồng bộ lại Sổ Cái ngày đó.

## Phase 3: Cập nhật API Ví và Thống Kê Thu Ngân
1. Cập nhật `/api/ktv/wallet/balance/route.ts` và `/api/finance/ktv-summary/route.ts`:
   - Bước 1: Fetch các dòng từ bảng `KTVDailyLedger` của KTV đó từ trước tới nay. (Chỉ lấy tổng `SUM()`).
   - Bước 2: Fetch dữ liệu Real-time của **riêng ngày hôm nay**.
   - Bước 3: Cộng 2 kết quả lại để ra số liệu cuối cùng siêu nhanh và chuẩn xác.
   - Tính toán ví: `gross_income = SUM(commission) + SUM(adjustment)` (Loại bỏ hoàn toàn Tip).
   - `available_balance = gross_income - Cọc 500k - SUM(withdrawn) - pending`.

## Phase 4: Thiết lập Tự Động Hóa (Cron Job)
1. Tạo một tiến trình tự động (có thể thông qua Supabase pg_cron hoặc Vercel Cron).
2. Đúng `02:00 sáng` mỗi đêm, gọi API ở Phase 2 với tham số là `Ngày hôm qua` để chốt sổ tự động.
