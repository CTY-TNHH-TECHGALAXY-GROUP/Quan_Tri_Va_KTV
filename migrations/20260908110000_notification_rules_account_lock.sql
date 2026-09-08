-- =============================================================================
-- Migration: Rule cho tin khoá / mở khoá tài khoản và xác nhận điểm danh
-- Date: 2026-09-08
-- =============================================================================
--
-- 1. TÁCH KHOÁ TÀI KHOẢN KHỎI `EMERGENCY`
--
-- `EMERGENCY` xưa nay gánh hai loại tin đi hai hướng ngược nhau:
--   • KTV bấm SOS trong phòng  → tin cho QUẦY (đúng với rule hiện tại).
--   • "Tài khoản của bạn đã bị khoá" → tin cho CHÍNH KTV.
-- Rule EMERGENCY để allowed_roles = admin/reception/dev và cờ 🎯 tắt, nên vế
-- thứ hai bị đẩy cho Admin/Lễ tân đọc một câu viết ở ngôi "bạn", còn KTV vừa bị
-- khoá thì không nhận được gì. Code đã đổi sang `ACCOUNT_LOCK` / `MANUAL_UNLOCK`
-- (hai type này đã có sẵn trong lib/notification-kind.ts).
--
-- Cả hai để allowed_roles rỗng: tin viết cho chính chủ thì chỉ chính chủ đọc.
-- Quản lý vẫn nắm được tình hình qua bản tổng hợp EMERGENCY của cron
-- ("Hệ thống vừa khóa N KTV: ..."), qua SecurityAuditLogs, và với trường hợp
-- khoá do từ chối đơn thì qua tin KTV_REJECT_ORDER bắn ngay sau đó.
--
-- 2. `ATTENDANCE_RESPONSE` VỀ ĐÚNG MỘT NGƯỜI
--
-- Tin này giờ được tạo ngay lúc hệ thống tự duyệt điểm danh (trước đây không
-- bao giờ được tạo vì route duyệt tay không chạy). Nội dung là "Đã ghi nhận tan
-- ca của bạn" — - viết cho KTV. Bỏ allowed_roles để Admin/Lễ tân không nhận bản
-- sao; họ đã có ATTENDANCE_REQUEST cho từng lượt điểm danh rồi.
-- =============================================================================

UPDATE "SystemConfigs"
SET value = '{
  "ACCOUNT_LOCK": {
    "label": "Khoá tài khoản (gửi chính chủ)",
    "icon": "🔒",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  },
  "MANUAL_UNLOCK": {
    "label": "Mở khoá tài khoản (gửi chính chủ)",
    "icon": "🔓",
    "allowed_roles": [],
    "include_target_employee": true,
    "require_on_shift": false,
    "sound": "reception-notification.wav",
    "enabled": true
  }
}'::jsonb || value
WHERE key = 'notification_rules';

UPDATE "SystemConfigs"
SET value = jsonb_set(value, '{ATTENDANCE_RESPONSE,allowed_roles}', '[]'::jsonb)
WHERE key = 'notification_rules' AND value ? 'ATTENDANCE_RESPONSE';

-- Đối chiếu sau khi chạy:
-- SELECT k AS type, v->'allowed_roles' AS roles, v->'include_target_employee' AS target
-- FROM "SystemConfigs", jsonb_each(value) AS e(k, v)
-- WHERE key = 'notification_rules'
--   AND k IN ('ACCOUNT_LOCK', 'MANUAL_UNLOCK', 'ATTENDANCE_RESPONSE', 'EMERGENCY')
-- ORDER BY k;
