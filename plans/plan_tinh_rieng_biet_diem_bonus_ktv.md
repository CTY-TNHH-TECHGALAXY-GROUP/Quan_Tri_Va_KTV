# Kế hoạch sửa logic tính riêng biệt điểm bonus và khắc phục dữ liệu đơn hàng

## Mục tiêu
1. Sửa logic tính điểm bonus (thưởng đánh giá) trên KTV Dashboard (ví bonus) và Cronjob để tính toán riêng biệt cho từng KTV. Chỉ KTV nào được đánh giá riêng >= 4 sao mới được thưởng điểm, không tự động chia đều hay cộng chung cho toàn bộ KTV trong đơn.
2. Cập nhật dữ liệu đơn hàng `001-04062026` của KTV `NH021` về đúng thực tế là không được đánh giá để kiểm tra tính chính xác của logic mới.

## Chi tiết thay đổi

### 1. Sửa đổi Code Logic
Cập nhật cách xác định rating của KTV (`techCode`) trong đơn hàng `b`:
- Duyệt qua các items của đơn hàng mà KTV đó tham gia (`techCode` có trong `item.technicianCodes`).
- Lấy rating lớn nhất của KTV đó (`maxKtvRating`):
  - Ưu tiên: `item.ktvRatings[techCode]` (không phân biệt hoa thường).
  - Fallback 1: `item.itemRating`.
  - Fallback 2: `b.rating`.
- Chỉ cộng điểm thưởng nếu `maxKtvRating >= 4`.

Các file sửa đổi:
- **[app/api/ktv/wallet/bonus/timeline/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/wallet/bonus/timeline/route.ts)**
- **[app/api/ktv/wallet/bonus/balance/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/wallet/bonus/balance/route.ts)**
- **[app/api/cron/sync-daily-ledger/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/cron/sync-daily-ledger/route.ts)**

### 2. Chạy Script Sửa Dữ Liệu Lỗi Đơn Hôm Nay
Chạy một đoạn code Node.js để cập nhật trực tiếp trong DB:
- Update `BookingItems` có `id = '11NDK-001-04062026-item1'` (dịch vụ của `NH021` trong đơn `001-04062026`):
  - Set `itemRating = null`
  - Set `ktvRatings = {}`

## Verification Plan
1. Chạy script sửa dữ liệu đơn hàng hôm nay.
2. Kiểm tra API timeline và balance của `NH011`: Vẫn nhận `+10 điểm` thưởng cho đơn `001-04062026`.
3. Kiểm tra API timeline và balance của `NH021`: Điểm thưởng biến mất (không nhận điểm cho đơn này nữa).
