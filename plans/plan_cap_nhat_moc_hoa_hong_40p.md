# Kế hoạch cập nhật mốc hoa hồng KTV 40 phút trong database

## Mục tiêu
Cập nhật cấu hình hoa hồng của KTV trong database sao cho mốc **40 phút** nhận mức hoa hồng bằng mốc **45 phút** (tức là **75.000đ**).

## Chi tiết thay đổi

### Cập nhật cấu hình trong bảng `SystemConfigs`
Chúng ta sẽ chạy một câu lệnh SQL (hoặc Node.js script) để cập nhật giá trị của cấu hình `ktv_commission_milestones`.

**Giá trị hiện tại:**
```json
{
  "1": 2000,
  "30": 50000,
  "45": 75000,
  "60": 100000,
  "70": 115000,
  "90": 150000,
  "100": 165000,
  "120": 200000,
  "180": 300000,
  "300": 500000
}
```

**Giá trị mới sau khi cập nhật (bổ sung `"40": 75000`):**
```json
{
  "1": 2000,
  "30": 50000,
  "40": 75000,
  "45": 75000,
  "60": 100000,
  "70": 115000,
  "90": 150000,
  "100": 165000,
  "120": 200000,
  "180": 300000,
  "300": 500000
}
```

## Cách thức triển khai
Chạy script Node.js hoặc câu lệnh SQL để cập nhật trực tiếp vào database:
```sql
UPDATE "SystemConfigs"
SET value = '{"1":2000,"30":50000,"40":75000,"45":75000,"60":100000,"70":115000,"90":150000,"100":165000,"120":200000,"180":300000,"300":500000}'
WHERE key = 'ktv_commission_milestones';
```

## Verification Plan
1. Chạy lại script kiểm tra cấu hình `scratch_check_config.js` để xác nhận mốc 40 phút đã hiển thị chính xác là **75.000đ**.
2. Không cần thay đổi bất kỳ dòng code logic nào, vì logic tính hoa hồng sẽ tự động nhận giá trị từ DB.
