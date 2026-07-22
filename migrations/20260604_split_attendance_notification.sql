-- =============================================================================
-- Migration: Tách ATTENDANCE thành ATTENDANCE_REQUEST + ATTENDANCE_RESPONSE
-- Date: 2026-06-04
-- Mục đích: Quầy chỉ nhận thông báo điểm danh (REQUEST), 
--           KTV chỉ nhận thông báo phản hồi (RESPONSE)
-- =============================================================================

-- Cập nhật notification_rules trong SystemConfigs:
-- 1. Giữ ATTENDANCE cũ (backward compat nếu còn thông báo cũ trong DB)
-- 2. Thêm ATTENDANCE_REQUEST: KTV bấm điểm danh → Quầy nhận
-- 3. Thêm ATTENDANCE_RESPONSE: Admin confirm/reject → KTV nhận

UPDATE "SystemConfigs"
SET value = value || '{
  "ATTENDANCE_REQUEST": {
    "label": "KTV điểm danh (Yêu cầu)",
    "icon": "📍",
    "allowed_roles": ["admin", "reception"],
    "include_target_employee": false,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "ATTENDANCE_RESPONSE": {
    "label": "Kết quả điểm danh (Phản hồi)",
    "icon": "✅",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "FEEDBACK": {
    "label": "Khách đánh giá (3 sao)",
    "icon": "⭐",
    "allowed_roles": ["admin"],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  }
}'::jsonb
WHERE key = 'notification_rules';

-- Cập nhật rule ATTENDANCE cũ: tắt include_target_employee (không gửi cho KTV nữa)
-- Giữ lại để backward compat với thông báo cũ
UPDATE "SystemConfigs"
SET value = jsonb_set(
  value,
  '{ATTENDANCE,include_target_employee}',
  'false'::jsonb
)
WHERE key = 'notification_rules';
