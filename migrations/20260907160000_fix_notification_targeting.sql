-- =============================================================================
-- Migration: Sửa định tuyến thông báo — tin cá nhân về đúng chính chủ
-- Date: 2026-09-07
-- =============================================================================
--
-- BỐI CẢNH
-- `include_target_employee` (cột 🎯 trong /admin/settings/notifications) đang bị
-- TẮT trên hàng loạt loại thông báo mang nội dung cá nhân, viết ở ngôi "bạn".
-- Khi cờ đó tắt, webhook rơi xuống nhánh phát theo vai trò, nên:
--
--   • COMPLAINT có 'ktv' trong allowed_roles ⇒ câu "Bạn nhận được đánh giá TỆ"
--     của MỘT người được đẩy tới máy của MỌI KTV (đã xảy ra ngày 03/09 với T016),
--     kèm cả tin "KTV X bị giáng chức xuống LOẠI A" từ KtvDisciplineService.
--   • REWARD / WALLET / ATTENDANCE_RESPONSE / LEAVE_RESPONSE / SHIFT_RESPONSE
--     ⇒ tin của KTV bị đẩy cho Admin/Quầy, còn chính chủ thì không nhận gì.
--
-- Code đã được chốt chặn ở trigger-webhook (tin có employeeId không bao giờ phát
-- theo vai trò KTV nữa). Migration này sửa nốt phần dữ liệu để chính chủ nhận lại
-- được thông báo của mình.
--
-- PHẦN 2 bổ sung rule cho 5 loại đang chạy thật nhưng không có trong bảng cài đặt
-- — thiếu rule thì webhook bỏ qua hoàn toàn, nên tin trừ điểm/trừ giờ kỷ luật
-- từ trước tới nay chưa từng có push.
-- =============================================================================

-- ─── PHẦN 1: Bật lại 🎯 cho các loại thông báo cá nhân ───────────────────────
UPDATE "SystemConfigs"
SET value = jsonb_set(value, '{REWARD,include_target_employee}', 'true'::jsonb)
WHERE key = 'notification_rules' AND value ? 'REWARD';

UPDATE "SystemConfigs"
SET value = jsonb_set(value, '{WALLET,include_target_employee}', 'true'::jsonb)
WHERE key = 'notification_rules' AND value ? 'WALLET';

UPDATE "SystemConfigs"
SET value = jsonb_set(value, '{ATTENDANCE_RESPONSE,include_target_employee}', 'true'::jsonb)
WHERE key = 'notification_rules' AND value ? 'ATTENDANCE_RESPONSE';

UPDATE "SystemConfigs"
SET value = jsonb_set(value, '{LEAVE_RESPONSE,include_target_employee}', 'true'::jsonb)
WHERE key = 'notification_rules' AND value ? 'LEAVE_RESPONSE';

UPDATE "SystemConfigs"
SET value = jsonb_set(value, '{SHIFT_RESPONSE,include_target_employee}', 'true'::jsonb)
WHERE key = 'notification_rules' AND value ? 'SHIFT_RESPONSE';

-- ─── PHẦN 1b: COMPLAINT — bỏ 'ktv' khỏi allowed_roles ───────────────────────
-- Tin phàn nàn có 2 dạng: bản global mô tả người bị phàn nàn (chỉ quản lý được
-- xem) và bản cá nhân gửi chính chủ. Để 'ktv' trong allowed_roles là mọi KTV
-- nhận cả hai.
UPDATE "SystemConfigs"
SET value = jsonb_set(
        jsonb_set(value, '{COMPLAINT,allowed_roles}', '["admin","reception","dev"]'::jsonb),
        '{COMPLAINT,include_target_employee}', 'true'::jsonb
    )
WHERE key = 'notification_rules' AND value ? 'COMPLAINT';

-- ─── PHẦN 2: Thêm rule cho các loại đang chạy nhưng chưa có cấu hình ─────────
-- Toán tử `||` với `value` ở BÊN PHẢI: key nào đã tồn tại thì giữ nguyên giá trị
-- hiện tại, chỉ những key còn thiếu mới được thêm vào. Chạy lại nhiều lần vô hại.
UPDATE "SystemConfigs"
SET value = '{
  "WARNING": {
    "label": "Nhắc nhở / Trừ điểm - trừ giờ",
    "icon": "⚠️",
    "allowed_roles": ["admin", "dev"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "DISCIPLINE": {
    "label": "Gắn cờ vi phạm kỷ luật",
    "icon": "🚩",
    "allowed_roles": ["admin", "dev"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "HANDOVER_REJECTED": {
    "label": "Bàn giao bị từ chối",
    "icon": "↩️",
    "allowed_roles": ["admin", "reception", "dev"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "REQUEST_CONFIRMED": {
    "label": "Quầy đã xử lý yêu cầu",
    "icon": "✅",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "ADDON_SERVICE": {
    "label": "Phát sinh dịch vụ chưa thu",
    "icon": "➕",
    "allowed_roles": ["admin", "reception", "dev"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  }
}'::jsonb || value
WHERE key = 'notification_rules';

-- ─── Đối chiếu sau khi chạy ─────────────────────────────────────────────────
-- SELECT k AS type,
--        v->'allowed_roles'         AS roles,
--        v->'include_target_employee' AS target,
--        v->'enabled'               AS enabled
-- FROM "SystemConfigs", jsonb_each(value) AS e(k, v)
-- WHERE key = 'notification_rules'
-- ORDER BY k;
