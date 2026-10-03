# Plan: Hiện thông báo "KTV tắt nhận đơn" cho quầy (có chuông)

**Mức 2** — đụng `migrations/*`. Đã duyệt 14/09/2026.

## Nguyên nhân gốc

Yêu cầu gốc: *"báo cả hai, tắt thì im lặng"*. Lần làm trước hiểu "im lặng" = không hiện gì, nên rule
`KTV_OFF_CALL` để `allowed_roles = []`. Dòng `StaffNotifications` vẫn được ghi (VD 14/09 15:20:41 UTC,
T069) nhưng không toast, không push, không ai thấy.

Vận hành chốt lại (14/09): tắt nhận đơn **hiện và có chuông**, giống bật.

## Việc làm

1. Migration `migrations/20260914230000_notification_rules_off_call_visible.sql`:
   `KTV_OFF_CALL.allowed_roles` → `["admin","reception","dev"]`; nhãn → "KTV tắt nhận đơn"; sound → `reception-notification.wav`.
   Code: bỏ `KTV_OFF_CALL` khỏi `SILENT_TYPES` (`lib/notification-kind.ts`).
   Backup `notification_rules` trước khi chạy.
2. Sửa comment đầu `lib/ktv-on-call-notify.ts` cho khớp hành vi mới.
3. Mô phỏng quy tắc người nhận trên cấu hình thật: quầy/admin thấy, có tiếng; KTV không thấy.

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — tin chung, `allowed_roles` không có `ktv` | Toast + push + lịch sử thông báo | `SystemConfigs.notification_rules` | Sửa 1 rule |
| Số liệu | Không có | Không có | — | Không áp dụng — chỉ là thông báo |
| Realtime | Không đổi | Bảng điều phối đã tự refresh khi có INSERT `StaffNotifications` | `StaffNotifications` | Đồng bộ |
| Quyền xem | Không thấy | Quầy / admin / dev thấy | — | Chỉ có tên + mã KTV |
| Tiếng | — | Có chuông, như tin bật | `SILENT_TYPES` | Bỏ `KTV_OFF_CALL` khỏi danh sách |

## Rủi ro & cách lùi

- Code bỏ `SILENT_TYPES` chỉ có hiệu lực sau deploy. Trong lúc chờ, tin tắt đã hiện (nhờ migration) nhưng
  toast vẫn im, push vẫn `silent`.
- Lùi: ghi lại `allowed_roles = []` hoặc khôi phục từ file backup.
