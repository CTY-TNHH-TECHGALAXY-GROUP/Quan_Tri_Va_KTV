# Kế Hoạch Đã Duyệt: Điều Chỉnh Logic Bonus Theo Thời Gian Làm Việc

Điều chỉnh logic tính điểm Bonus của KTV dựa trên tổng thời gian gán (thời gian làm việc thực tế) của KTV trong một Đơn hàng (Booking). Nếu thời gian làm dưới 60 phút, giá trị base của Ca làm việc sẽ bị giảm một nửa.

## Phân tích logic hiện tại
Hiện tại, hệ thống đã tính sẵn biến `totalDuration` cho từng KTV trong mỗi đơn hàng (bằng cách cộng thời gian từ `segments` hoặc lấy thời gian chuẩn của dịch vụ). 
Logic tính Bonus trước đây:
`Điểm thực nhận = Math.floor(BasePoints / Tổng_số_KTV_làm_chung_đơn)`

## Bổ sung Logic Mới
Thêm quy tắc xét `totalDuration` (Tổng thời gian làm của KTV trong đơn đó):
1. **Dưới 60 phút (`totalDuration < 60`)**: KTV chỉ được lấy `BasePoints / 2` làm điểm cơ sở.
2. **Từ 60 phút trở lên (`totalDuration >= 60`)**: KTV lấy nguyên `BasePoints` theo cấu hình của Ca.
3. **Làm chung (Splitting)**: Vẫn giữ quy tắc chia số lượng người làm chung. Điểm cuối cùng = `Math.floor(Điểm_Cơ_Sở_Mới / Tổng_Số_KTV)`.

*Ví dụ:* 1 Đơn có 2 KTV (Ca 1 - 20đ).
- KTV A làm DV 30 phút -> Thời gian < 60p -> Base của A bị giảm còn 10đ. Vì làm chung với B (2 người) -> Điểm của A = `10 / 2 = 5đ`.
- KTV B làm DV 90 phút -> Thời gian > 60p -> Base của B giữ nguyên 20đ. Vì làm chung (2 người) -> Điểm của B = `20 / 2 = 10đ`.

## Các File Đã Thay Đổi

### Logic Tính Tiền Backend

#### [MODIFY] `app/api/ktv/history/route.ts`
- Tìm đoạn gán `basePoints` theo Ca (`let basePoints = s1Bonus; ...`).
- Bổ sung logic: `if (totalDuration < 60) { basePoints = basePoints / 2; }`
- Logic này sẽ áp dụng để hiển thị số điểm Bonus trên App KTV.

#### [MODIFY] `app/api/cron/sync-daily-ledger/route.ts`
- Bổ sung logic điều chỉnh BasePoints bằng cách dùng biến phụ `adjustedBasePoints`:
```typescript
let adjustedBasePoints = basePoints;
if (totalDuration < 60) {
    adjustedBasePoints = basePoints / 2;
}
```
- Logic này áp dụng khi Job Cron ban đêm chốt sổ để ghi vào Database, tránh side-effect biến `basePoints` ở vòng lặp ngoài.
