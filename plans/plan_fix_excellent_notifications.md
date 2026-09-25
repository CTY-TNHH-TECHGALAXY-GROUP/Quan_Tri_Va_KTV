# Kế hoạch sửa lỗi thông báo đánh giá Excellent cho KTV và Quầy

**Vấn đề**: Khi khách hàng đánh giá Excellent (4 sao) cho một dịch vụ, KTV và Quầy (Reception) không nhận được thông báo realtime.

## Nguyên nhân gốc rễ (Root Causes)
1. **Lỗi logic Trigger `fn_notify_ktv_on_item_rating` (Bảng BookingItems)**:
   - Nếu đơn hàng có nhiều KTV (Multi-KTV), API sẽ cập nhật từng KTV một vào cột `ktvRatings` dạng JSON. Lúc này `itemRating` tổng thể có thể vẫn là `NULL` cho đến khi tất cả KTV được đánh giá. Tuy nhiên, ở dòng đầu tiên của trigger, nếu `NEW."itemRating" IS NULL`, hàm sẽ gọi `RETURN NEW;` và **dừng toàn bộ quá trình**. Điều này khiến thông báo bị "nuốt mất" hoàn toàn!
   - Trigger hiện tại **KHÔNG** hề tạo bản ghi thông báo nào cho Quầy Lễ Tân (`employeeId = NULL`) khi KTV nhận được đánh giá tốt (chỉ tạo khi bị 1 sao).

2. **Lỗi logic Trigger `fn_master_notification_handler` (Bảng Bookings)**:
   - Tương tự, nếu khách hàng đánh giá tổng thể toàn bộ đơn hàng (rating >= 4), trigger này chỉ tạo thông báo `REWARD` cho KTV, không thông báo cho Quầy.

## Proposed Changes

### 1. Cập nhật Trigger `fn_notify_ktv_on_item_rating`
Sẽ tạo một SQL script để chạy `CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_item_rating()` với các thay đổi sau:
- Xóa bỏ câu lệnh chặn sai lầm `OR NEW."itemRating" IS NULL THEN RETURN NEW;` để đảm bảo hệ thống vẫn xử lý đánh giá KTV lẻ tẻ (khi `ktvRatings` thay đổi nhưng `itemRating` tổng vẫn là `NULL`).
- Thay đổi vòng lặp quét `ktvRatings` để luôn luôn quét chính xác dù là Single-KTV hay Multi-KTV.
- **Thêm tính năng thông báo cho Quầy**: Bất cứ khi nào tạo thông báo `REWARD` cho KTV, hệ thống sẽ chèn thêm một dòng vào bảng `StaffNotifications` với `employeeId = NULL` và `type = 'FEEDBACK'`. Lời nhắn sẽ có dạng: `KTV [Mã KTV] nhận đánh giá XUẤT SẮC từ đơn #[Mã Bill]`.

### 2. Cập nhật Trigger `fn_master_notification_handler`
- **Thêm tính năng thông báo cho Quầy**: Nếu `NEW.rating >= 4`, ngoài việc chia điểm thưởng cho KTV, hệ thống sẽ chèn thêm một thông báo cho `employeeId = NULL` với `type = 'FEEDBACK'`.

## User Review Required
> [!IMPORTANT]
> - Đối với thông báo cho Quầy Lễ Tân, mã sẽ dùng `type = 'FEEDBACK'`. Theo file `NotificationProvider.tsx`, loại này sẽ đổ chuông `reception-notification.wav` và xuất hiện hộp thoại nhỏ ở màn hình điều phối. Đây là trải nghiệm UI phù hợp nhất.
> - KTV vẫn sẽ nhận được pop-up đỏng đảnh `type = 'REWARD'` kèm chuông `ktv-nhan-thuong.wav`.
> - Do đây là thay đổi trên Database Triggers, tôi sẽ tạo ra một file SQL (ví dụ: `20260426000000_fix_excellent_notifications.sql`). Xin hãy cho biết tôi có nên dùng command để chạy file SQL này trực tiếp (nếu bạn có cài sẵn `supabase cli` kết nối DB) hay bạn sẽ copy/paste chạy nó bằng tay trên Supabase Dashboard?

## Verification Plan
1. Viết và sinh ra file mã SQL thay đổi Database Trigger.
2. (Chờ người dùng hoặc chạy tự động) Apply mã SQL vào Supabase.
3. Test bấm đánh giá 4 sao trên hệ thống Web nội bộ (`wrb-noi-bo-dev`).
4. Kiểm tra xem trên App KTV và màn hình Lễ Tân có hiện chuông báo ngay lập tức hay không.
