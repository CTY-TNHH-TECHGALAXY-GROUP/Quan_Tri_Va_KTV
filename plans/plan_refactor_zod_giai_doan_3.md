# Kế hoạch Refactor API bằng Zod (Giai đoạn 3: Final Sweep)

Đây là chặng đường cuối cùng để phủ Zod Validation lên 100% các API còn lại trong dự án, đảm bảo một hàng rào bảo vệ đồng nhất và vững chắc tuyệt đối.

## Proposed Changes

---

### [NEW] `lib/schemas/ktv.schema.ts` (Bổ sung)
Thêm các schema cho các luồng phụ của KTV:
- **KtvReviewSchema:** Đánh giá.
- **KtvWalletWithdrawSchema:** Rút tiền KTV.
- **KtvPushSyncSchema / UnsubscribeSchema:** Quản lý Push Token.
- **KtvAttendanceConfirmSchema:** Xác nhận attendance.

### [NEW] `lib/schemas/support.schema.ts`
Tạo file schema cho module Support nội bộ:
- **SupportAreaSchema:** Thêm/Sửa khu vực hỗ trợ.
- **SupportTaskSchema:** Tạo/Cập nhật công việc hỗ trợ.
- **SupportTemplateSchema:** Mẫu câu hỗ trợ.

### [NEW] `lib/schemas/notification.schema.ts`
Tạo file schema cho Webhook và Push Notification:
- **PushNotificationSchema:** Bắn thông báo.
- **WebhookTriggerSchema:** Kích hoạt Webhook.

---

### Refactor API Controllers
Áp dụng mẫu Zod validation cho toàn bộ 15 file route còn lại:
- `app/api/ktv/review/route.ts`
- `app/api/ktv/wallet/withdraw/route.ts`
- `app/api/ktv/attendance/confirm/route.ts`
- `app/api/ktv/push-sync/route.ts`
- `app/api/ktv/push-unsubscribe/route.ts`
- `app/api/ktv/history/route.ts`
- `app/api/ktv/booking/route.ts`
- `app/api/ktv/interaction/route.ts`
- `app/api/support/areas/route.ts`
- `app/api/support/tasks/route.ts`
- `app/api/support/templates/route.ts`
- `app/api/notifications/push/route.ts`
- `app/api/notifications/trigger-webhook/route.ts`
- `app/api/admin/notification-rules/route.ts`
- `app/api/cron/sync-daily-ledger/route.ts`
