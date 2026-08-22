# 🛠 Kế hoạch sửa lỗi hiển thị ngày đơn hàng trong Lịch sử KTV

## 📝 Nguyên nhân gốc rễ (Root Cause)
Theo phân tích, khi Admin thao tác thêm đơn/dịch vụ hoặc KTV vào một đơn cũ (như đơn ngày 27/05), hệ thống ghi nhận `bookingDate` là ngày 27/05. Tuy nhiên, API truy xuất Lịch sử thu nhập của KTV (`app/api/ktv/history/route.ts`) lại đang dùng trường `createdAt` (thời điểm thực tế lưu vào database) để làm bộ lọc ngày (`dateFrom`, `dateTo`). 
Vì thế, thao tác bổ sung thực hiện vào "Hôm nay" sẽ khiến `createdAt` mang ngày của hôm nay, dẫn đến việc KTV xem lịch sử của ngày 27/05 không thấy đơn, mà lại thấy ở "Hôm nay".

## 🚀 Đề xuất thay đổi (Implementation Plan) - Đã triển khai

### 1. File cần sửa đổi
#### [MODIFY] `app/api/ktv/history/route.ts`

### 2. Chi tiết các thay đổi
- Đổi trường lọc ngày trong Supabase query:
  - Cũ: `.gte('createdAt', fromFilter)` và `.lte('createdAt', toFilter)`
  - Mới: `.gte('bookingDate', fromFilter)` và `.lte('bookingDate', toFilter)`
- Cập nhật hàm `.order()`:
  - Thay vì `.order('createdAt', { ascending: false })` đổi thành `.order('bookingDate', { ascending: false })`
- Cập nhật logic tính Bonus KTV theo ca (Shift Map):
  - Lấy ngày từ `b.bookingDate` (fallback `b.createdAt` nếu null) thay vì chỉ lấy từ `b.createdAt`.
- Bổ sung `bookingDate` vào danh sách cột được `.select()` trong bảng `Bookings`.

## Trạng thái
- Đã được user phê duyệt (OK).
- Đã code và lưu thay đổi vào project.
