# Kế hoạch Fix lỗi Hiển thị KTV (Menu VIP & Sổ Tua)

**Mô tả vấn đề:**
1. **Lỗi Menu VIP**: KTV Type B (như NH079) đã hết thời gian cài đặt nhận đơn (VD: cài đến 17:04), nhưng trên Menu VIP của Khách hàng vẫn hiển thị KTV đó. Mặc dù ở trang Lễ tân (Hình 2) có báo chữ đỏ "Đã hết giờ".
2. **Lỗi Sổ Tua**: KTV (như NH027) đã chủ động bấm nút "TẮT NHẬN ĐƠN", nhưng trên Sổ Tua vẫn hiện chữ màu xanh "Sẵn sàng" thay vì biến mất hoặc báo Tan ca. 

## Nguyên nhân gốc rễ (Root Cause)

1. **Về lỗi Menu VIP (KTV hết giờ vẫn hiện)**:
   - Các KTV Type B (như NH079) được tự động quét và chuyển trạng thái về `OFFLINE` thông qua một cronjob chạy ngầm (`KtvOnlineService.cleanupExpiredOnline`).
   - Tuy nhiên, biến số cấu hình `EXPIRED_BUFFER_MINUTES` đang bị set là **`60` (phút)**. Nghĩa là sau khi KTV hết giờ, hệ thống vẫn "du di" thêm 1 tiếng đồng hồ để họ hoàn thành khách, và KHÔNG tắt online_status của KTV. Điều này dẫn tới Menu VIP của Khách (đọc trực tiếp trạng thái `ONLINE`) vẫn lấy KTV đó lên trong suốt 1 tiếng sau khi hết giờ.

2. **Về lỗi Sổ Tua KTV (Tắt app nhưng vẫn hiện Sẵn sàng)**:
   - KTV NH027 là KTV đã có đơn (làm 2 tua). Khi KTV bấm nút "Tắt Nhận Đơn", hệ thống API gọi hàm `KtvOnlineService.goOffline`. 
   - Hàm này thực thi lệnh `.delete()` (Xoá hoàn toàn) KTV khỏi bảng `TurnQueue` (Sổ tua).
   - Tuy nhiên, việc xoá hẳn record sẽ làm KTV bị mất thông tin "Đã làm 2 tua" trên màn hình Lễ tân. Thường thao tác xoá (delete) sẽ gặp lỗi hoặc bị block nên trạng thái KTV vẫn giữ nguyên là 'waiting' (Sẵn sàng) gây ra lỗi hiển thị.

## Giải pháp (Đề xuất thay đổi)

### 1. `lib/services/KtvOnlineService.ts`

#### [MODIFY] `lib/services/KtvOnlineService.ts`

- **Fix Menu VIP**: Đổi hằng số `EXPIRED_BUFFER_MINUTES = 60;` thành `0;`. Việc xoá buffer giúp hệ thống gạch tên KTV này khỏi trạng thái ONLINE ngay lập tức đúng giờ cài đặt, loại bỏ KTV khỏi Menu VIP.
- **Fix Sổ Tua**: Thay đổi logic của method `goOffline()`:
  - **Thay vì** `.delete()` (Xóa KTV khỏi sổ tua).
  - **Ta sẽ dùng lệnh** `.update({ status: 'off' })` đối với những KTV đã có tua (`turns_completed > 0`), và `.delete()` với KTV chưa làm tua nào để không làm rác sổ tua.
  - Điều này giúp KTV vẫn giữ được lịch sử "Đã làm X tua" trong ngày, nhưng trên giao diện Lễ tân, KTV sẽ trôi xuống đáy danh sách với chữ "Tan ca" màu xám. Vừa đúng nghiệp vụ, vừa không gây lỗi kẹt "Sẵn sàng".

## User Review Required
> [!IMPORTANT]
> Phương pháp cập nhật trạng thái Sổ tua thành 'off' thay vì xoá trắng KTV là chuẩn nhất đối với các KTV đã làm tua trong ngày. Việc giảm buffer từ 60 phút xuống 0 phút sẽ khiến KTV biến mất khỏi Menu VIP đúng ngay khoảnh khắc hết giờ.

Anh/Chị vui lòng **DUYỆT** kế hoạch này để tiến hành sửa code và lưu vết nhé.
