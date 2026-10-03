-- Migration: 20260607_fix_notification_roles.sql
-- Mục đích: Sửa lỗi thông báo bị loạn (Spam Lễ tân, KTV nhận nhầm đơn/nhận thông báo khi tan ca)
-- Bằng cách điều chỉnh lại allowed_roles trong SystemConfigs.notification_rules

UPDATE "SystemConfigs"
SET value = jsonb_set(
    jsonb_set(
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            value::jsonb,
                            '{KTV_NEW_ORDER, allowed_roles}', '[]'::jsonb
                        ),
                        '{NEW_ORDER, allowed_roles}', '["admin", "reception"]'::jsonb
                    ),
                    '{REWARD, allowed_roles}', '[]'::jsonb
                ),
                '{ATTENDANCE, allowed_roles}', '["admin"]'::jsonb
            ),
            '{ATTENDANCE_RESPONSE, allowed_roles}', '[]'::jsonb
        ),
        '{EARLY_EXIT, allowed_roles}', '["admin"]'::jsonb
    ),
    '{KTV_REVIEW, allowed_roles}', '["admin"]'::jsonb
)
WHERE key = 'notification_rules';
