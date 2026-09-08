-- =============================================================================
-- Migration: Rule thông báo cho việc KTV BẬT / TẮT nhận đơn
-- Date: 2026-09-08
-- =============================================================================
--
-- BỐI CẢNH
-- Bật "Nhận Đơn" ở màn chấm công trước đây chỉ chạy một lệnh UPDATE trên bảng
-- `Staff`. Màn điều phối không subscribe bảng `Staff` và cũng không polling dữ
-- liệu, nên quầy không nhận được gì: không chuông, không toast, không push, và
-- danh sách "KTV Đang Online" chỉ đổi khi có sự kiện khác tình cờ kích refresh.
--
-- Code đã ghi StaffNotifications ở cả hai đường (/api/ktv/on-call và
-- /api/ktv/type-d/on-call). Migration này khai báo rule cho hai loại tin đó.
--
-- BẬT thì kêu, TẮT thì im — theo đúng yêu cầu vận hành:
--
--   KTV_ON_CALL  : allowed_roles = admin/reception/dev ⇒ quầy có toast + push.
--   KTV_OFF_CALL : allowed_roles = [] ⇒ webhook không push cho ai, và
--                  NotificationProvider lọc bỏ nên cũng không có toast.
--                  Dòng dữ liệu VẪN được ghi, nên bảng điều phối tự làm mới
--                  (nó đã subscribe INSERT trên StaffNotifications) và admin
--                  vẫn tra được trong lịch sử thông báo.
--
-- Cả hai đều là tin CHUNG (employeeId = null) nên `include_target_employee`
-- không có tác dụng gì; để false cho đúng ngữ nghĩa.
-- =============================================================================

UPDATE "SystemConfigs"
SET value = '{
  "KTV_ON_CALL": {
    "label": "KTV bật nhận đơn",
    "icon": "🔔",
    "allowed_roles": ["admin", "reception", "dev"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "KTV_OFF_CALL": {
    "label": "KTV tắt nhận đơn (im lặng)",
    "icon": "⚪",
    "allowed_roles": [],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "",
    "enabled": true
  }
}'::jsonb || value
WHERE key = 'notification_rules';

-- Toán tử `||` với `value` ở BÊN PHẢI: key nào đã có thì giữ nguyên, chỉ thêm
-- key còn thiếu. Chạy lại nhiều lần vô hại.
--
-- Đối chiếu sau khi chạy:
-- SELECT k AS type, v->'allowed_roles' AS roles, v->'enabled' AS enabled
-- FROM "SystemConfigs", jsonb_each(value) AS e(k, v)
-- WHERE key = 'notification_rules' AND k LIKE 'KTV_%CALL'
-- ORDER BY k;
