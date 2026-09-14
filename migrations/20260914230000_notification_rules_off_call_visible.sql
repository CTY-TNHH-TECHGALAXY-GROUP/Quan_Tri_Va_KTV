-- =============================================================================
-- Migration: KTV_OFF_CALL hiện cho quầy, có chuông
-- Date: 2026-09-14
-- Plan: plans/plan_thong_bao_tat_nhan_don.md
-- =============================================================================
--
-- Migration 20260908090000 để KTV_OFF_CALL có allowed_roles rỗng, hiểu "tắt thì
-- im lặng" là không hiện gì. Dòng StaffNotifications vẫn được ghi nhưng không ai
-- thấy. Vận hành chốt lại: tắt nhận đơn cũng báo quầy như bật, CÓ chuông.
-- Code đã bỏ KTV_OFF_CALL khỏi SILENT_TYPES (lib/notification-kind.ts).
-- =============================================================================

UPDATE "SystemConfigs"
SET value = jsonb_set(
        jsonb_set(
            jsonb_set(value, '{KTV_OFF_CALL,allowed_roles}', '["admin","reception","dev"]'::jsonb),
            '{KTV_OFF_CALL,label}', '"KTV tắt nhận đơn"'::jsonb
        ),
        '{KTV_OFF_CALL,sound}', '"reception-notification.wav"'::jsonb
    )
WHERE key = 'notification_rules' AND value ? 'KTV_OFF_CALL';

-- Đối chiếu sau khi chạy:
-- SELECT value->'KTV_OFF_CALL' FROM "SystemConfigs" WHERE key = 'notification_rules';
