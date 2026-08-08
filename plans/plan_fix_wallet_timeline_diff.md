# Kế hoạch giải quyết chênh lệch số dư ví KTV (NH025)

**Trạng thái**: 🟢 Đã duyệt (Phương án B - Gộp hiển thị theo sổ cái)

## 🎯 Mục tiêu
Sửa API `timeline/route.ts` để:
1. Số dư chạy (running balance) của lịch sử khớp 100% với Số dư khả dụng (available_balance) ở phía trên.
2. Nhóm gọn tiền tua và tiền tip của các ngày quá khứ theo từng ngày (Tổng tiền tua ngày DD/MM/YYYY) lấy từ Sổ cái (`KTVDailyLedger`).
3. Vẫn giữ nguyên hiển thị chi tiết (rõ ràng) cho các khoản Điều chỉnh ví (WalletAdjustments - Tiền trừ/thưởng hệ thống) và Rút tiền (KTVWithdrawals) cho tất cả các ngày.
4. Vẫn hiển thị chi tiết từng đơn hàng (Tiền tua đơn NH-...) cho các hóa đơn của **ngày hôm nay** (do chưa chốt sổ cái).

## 🛠️ Chi tiết triển khai

### 1. Thay đổi logic lấy dữ liệu (API `timeline/route.ts`)
- **Ngày mốc (realtimeStartStr):** Xác định ngày bắt đầu tính realtime (thường là ngày hôm nay), tương tự logic ở API `balance/route.ts`.
- **Sổ cái (Past Days):** Query bảng `KTVDailyLedger` với `date < todayStr`. 
  - Mỗi record (nếu có `total_commission` > 0), sinh ra một dòng timeline: `{ type: 'COMMISSION', title: 'Tổng tiền tua ngày <date>', amount: total_commission, ... }`.
  - Mỗi record (nếu có `total_tip` > 0), sinh ra một dòng timeline: `{ type: 'TIP', title: 'Tổng tiền tip ngày <date>', amount: total_tip, ... }`.
- **Đơn hàng (Today):** Chỉ query `Bookings` với `timeStart >= realtimeStartStr`. Tính commission và tip như cũ và đưa vào timeline dưới dạng chi tiết từng đơn.
- **Adjustments & Withdrawals:** Giữ nguyên logic query từ đầu (`START_DATE`), đưa chi tiết tất cả các khoản thưởng/phạt và rút tiền vào timeline.

### 2. Logic tính Running Balance (Số dư lũy kế)
- Không thay đổi thuật toán (`currentBalance += amount` và `running_balance = currentBalance - minDeposit`), nhưng nhờ dữ liệu đầu vào (từ Sổ cái) đã chính xác, phép tính này sẽ tự động ra kết quả khớp 100% với `balance/route.ts`.

## 🧪 Verification Plan
- Chạy thử API `timeline` cho NH025 để đảm bảo số dư dòng mới nhất đúng bằng 2,552,000 + 148,000 = 2,700,000đ.
- Kiểm tra các dòng lịch sử quá khứ có hiển thị "Tổng tiền tua ngày..." thay vì chi tiết đơn hàng.
- Kiểm tra các khoản phạt hệ thống/giặt đồ vẫn hiển thị rõ ràng.
