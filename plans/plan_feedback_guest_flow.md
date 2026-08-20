# Kế Hoạch Triển Khai: Nâng cấp hệ thống Feedback theo Khách (Guest Flow)

> **Người lập kế hoạch**: Antigravity (Sparring Partner Role)
> **Trạng thái**: Đã duyệt (Approved) - Triển khai theo Hướng A (Đồng bộ kép)

## 🎯 1. Phân tích Yêu cầu (Đã chốt)
User mong muốn: **Đánh giá theo từng Guest (Khách hàng)**.
- Khi một khách hàng (Guest) đánh giá, hệ thống sẽ lưu tổng quan vào bảng `BookingGuests`.
- **Yêu cầu cốt lõi**: "Những người làm chung phải cùng nhau làm tốt". Do đó, sau khi lưu vào `BookingGuests`, hệ thống phải TỰ ĐỘNG ĐỒNG BỘ (sync) mức đánh giá đó xuống tất cả các dịch vụ (`BookingItems`) mà vị khách đó đã sử dụng.
- **Mục đích**: Nhờ việc đồng bộ ngược xuống `BookingItems`, Trigger thưởng (`tr_notify_ktv_on_item_rating`) vốn có sẵn trong Database sẽ được kích hoạt tự động. Các KTV phục vụ chung cho vị khách đó sẽ được chia thưởng / phạt công bằng, không bị mất tiền thưởng.

---

## 🛠️ 2. Kế hoạch Code chi tiết (Hướng A)

### Bước 1: Cập nhật Database Schema
- Chạy file migration `20260817221455_add_feedback_to_booking_guests.sql` bằng lệnh Supabase CLI để thêm các cột: `ktv_ratings`, `rating`, `guest_feedback` vào bảng `BookingGuests`.

### Bước 2: Sửa logic trong `KioskFeedback.logic.ts`
- Ở nhánh xử lý `guestIdsToUpdate` (luồng Guest mới):
  1. Cập nhật Rating và Comment vào bảng `BookingGuests` (như code nháp hiện tại).
  2. **[THÊM MỚI]**: Fetch tất cả các `BookingItems` có `guest_id` trùng với danh sách guest vừa rate.
  3. Duyệt qua từng `BookingItems` này, tính toán lại `ktvRatings` và `itemRating` tương ứng với các KTV phục vụ dịch vụ đó.
  4. Bắn lệnh `UPDATE BookingItems` để cập nhật Rating. Ngay khi lệnh này chạy, Supabase Trigger sẽ tự động chộp lấy và chia điểm thưởng cho KTV.

### Bước 3: Kiểm tra và Commit
- Chạy kiểm tra kỹ thuật.
- Commit toàn bộ các file Nhóm 1 (KioskFeedback, FeedbackDashboard, useDispatchBoard, TableInSupabase...) với một atomic commit rõ ràng.

---
*Plan này được tạo dựa trên sự thống nhất giữa AI và User.*
