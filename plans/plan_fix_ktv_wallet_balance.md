# Kế hoạch đồng bộ hóa Số dư Ví KTV (Tạm thời)

## Vấn đề hiện tại
- **Mâu thuẫn dữ liệu**: "Số dư hiện tại" trên giao diện KTV Wallet hiển thị sai (cao hơn thực tế), trong khi "Lịch sử giao dịch" (Timeline) tính toán đúng.
- **Nguyên nhân gốc rễ**: 
  - API `balance` sử dụng cơ chế lai (Hybrid) giữa dữ liệu đã chốt trong `KTVDailyLedger` và đơn hàng thực tế (Realtime). Do lỗi tính toán mốc thời gian, các đơn hàng của "ngày hôm nay" bị tính trùng (double count) cả trong Ledger và Realtime.
  - API `balance` cộng gộp các khoản Điều chỉnh (WalletAdjustments) và Rút tiền (KTVWithdrawals) từ toàn bộ lịch sử, thay vì từ mốc bắt đầu `2026-05-04` như API `timeline`.

## Giải pháp triển khai
1. **Khôi phục cơ chế Hybrid an toàn**: API `/api/ktv/wallet/balance/route.ts` VẪN SẼ tiếp tục sử dụng `KTVDailyLedger` để giữ hiệu năng hệ thống khi scale.
2. **Fix triệt để lỗi Double-Counting**: 
   - Lọc bỏ Sổ cái (Ledger) của "ngày hôm nay" (VD: `date === '2026-05-08'`) ra khỏi phép cộng của Sổ cái.
   - Tính toán mốc `realtimeStartStr` chuẩn xác dựa trên các Ledger trong quá khứ mà không bị lệch múi giờ UTC. Điều này đảm bảo toàn bộ đơn hàng của "ngày hôm nay" sẽ luôn được tính bằng cơ chế Realtime.
3. **Đồng bộ mốc thời gian**: Giới hạn việc truy vấn dữ liệu từ bảng `WalletAdjustments` và `KTVWithdrawals` bắt đầu từ mốc `2026-05-04` để khớp 100% với màn hình Timeline.
