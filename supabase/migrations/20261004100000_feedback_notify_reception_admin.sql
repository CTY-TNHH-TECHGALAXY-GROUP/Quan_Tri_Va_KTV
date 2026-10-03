-- 04/10/2026: reception (quầy) and admin must also receive FEEDBACK notifications.
-- 20261003091000 set FEEDBACK.allowed_roles = [] (only the rated KTV). Add 'admin' and
-- 'reception' to whatever roles are configured, keep include_target_employee for the KTV.
-- Role ids follow /admin/settings/notifications (ROLE_OPTIONS); lib/push-helper.ts maps
-- 'reception' to RECEPTIONIST / LEAD_RECEPTIONIST / legacy RECEPTION. Idempotent.
UPDATE "SystemConfigs" sc
SET value = jsonb_set(
      COALESCE(jsonb_unwrap_string(sc.value), '{}'::jsonb),
      '{FEEDBACK,allowed_roles}',
      (SELECT COALESCE(jsonb_agg(DISTINCT r ORDER BY r), '[]'::jsonb)
         FROM (
           SELECT jsonb_array_elements_text(COALESCE(jsonb_unwrap_string(sc.value)->'FEEDBACK'->'allowed_roles', '[]'::jsonb)) AS r
           UNION SELECT 'admin'
           UNION SELECT 'reception'
         ) roles),
      true),
    updated_at = now()
WHERE sc.key = 'notification_rules'
  AND jsonb_unwrap_string(sc.value) ? 'FEEDBACK';
