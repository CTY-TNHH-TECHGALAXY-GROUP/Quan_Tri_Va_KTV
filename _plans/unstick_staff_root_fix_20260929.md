# Bản sửa nguyên nhân kẹt đơn — Supabase TEST

Người dùng đã duyệt sửa file ổn định trong cuộc hội thoại trước. Bản này ghi rõ thay đổi trước khi sửa theo `.agents/AGENTS.md`.

```diff
--- a/supabase/migrations/20260928010000_start_after_completed_queue.sql
+++ b/supabase/migrations/20260929010000_unstick_staff_and_running_duration.sql
- AND (old_seg.actualEndTime = '' OR old_seg.handoverTime = '')
+ AND (old_seg.actualEndTime = '' OR (old_seg.handoverTime = '' AND old_item.handover_status <> 'SKIPPED'))

--- a/ktv_release_work_atomic
+++ b/ktv_release_work_atomic
- Bỏ qua promotion khi đã có ACTIVE; để TurnQueue trỏ đơn cũ.
+ Sau release, nếu TurnQueue vẫn trỏ đơn vừa xong, trỏ tới ACTIVE hợp lệ kế tiếp trong cùng giao dịch.

--- a/app/api/ktv/booking/_handlers/handleGetBooking.ts
+++ b/app/api/ktv/booking/_handlers/handleGetBooking.ts
- Ưu tiên TurnQueue cũ và tự hoàn tất mọi ACTIVE khác khi GET.
+ Ưu tiên phân công ACTIVE còn hiệu lực; GET không tự hoàn tất công việc.

--- a/app/reception/dispatch/_components/QuickDispatchTable.tsx
+++ b/app/reception/dispatch/_components/QuickDispatchTable.tsx
- Chỉ mở thời lượng đang chạy nếu đã bật nối tiếp và IN_PROGRESS.
+ Cho sửa thời lượng của ca đang làm hoặc PAUSED, kể cả chưa bật nối tiếp.

--- a/app/reception/dispatch/actions.ts
+++ b/app/reception/dispatch/actions.ts
- Đường lưu A/B đang chạy không gửi thông báo.
+ Lưu thời lượng nguyên tử và gửi thông báo cho nhân viên; thất bại thông báo trả cảnh báo.
```

Kiểm thử: ca cũ chưa bàn giao phải bị chặn; ca đã SKIPPED được bắt đầu trong hạn mức; queue cũ được chuyển sang ACTIVE mới; đổi 30→60 phút khi đang làm và PAUSED, giữ lịch B và kiểm tra trùng giờ. Chỉ áp dụng migration và kiểm thử vào project TEST `eknggruuiuadwldacpmb`.
