# Kế Hoạch Đã Duyệt: Khắc Phục Lỗi Điểm Danh Tan Ca Qua Đêm

**Trạng thái:** Đã hoàn thành (Done)
**Nhiệm vụ:** Fix lỗi KTV làm ca 3 không thể điểm danh tan ca sau 00:00.
**Thiết lập Spa:** Mở cửa 09:00 sáng, đóng cửa 02:00 sáng hôm sau.

## 1. Giải pháp cấu hình (Day Cut-off Time)
Do Spa đóng cửa lúc 02:00 sáng, thời điểm an toàn để chốt/cắt ngày (Business Day) là **06:00 sáng**.
Đã tạo biến cấu hình trong bảng `SystemConfigs` của Supabase:
- Key: `spa_day_cutoff_hours`
- Value: `6` (tương đương 06:00 sáng)

## 2. API Cập Nhật
- **`app/api/ktv/settings/route.ts`**: Bổ sung `spa_day_cutoff_hours` vào cài đặt trả về (mặc định là 6).
- **`app/api/ktv/attendance/status/route.ts`**: Lấy `spa_day_cutoff_hours` từ Database và truy xuất bản ghi trong khung giờ `06:00 ngày hôm nay` đến `05:59 ngày mai`.
- **`app/api/ktv/attendance/route.ts`**: Cập nhật logic khi tạo/cập nhật bảng `TurnQueue` (Sổ tua), chốt ngày ghi nhận tua theo `Business Day` chứ không theo giờ `Calendar Day`.

## 3. Frontend Cập Nhật
- **`app/ktv/attendance/Attendance.logic.ts`**: Tích hợp biến `dayCutoffHours` để tính toán chính xác điều kiện `canCheckOut` và kiểm tra ca đi làm trễ (Late Checkin) ngay cả khi thời gian hiện tại nằm trong khoảng từ `00:00` đến `05:59`.
