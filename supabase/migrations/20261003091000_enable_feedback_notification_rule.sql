-- 03/10/2026: kiosk feedback now writes its FEEDBACK notification (column fix in
-- app/reception/feedback/_components/actions.ts). Turn the FEEDBACK rule on so the rated KTV
-- sees it — ONLY that KTV: no role broadcast (allowed_roles []) + include_target_employee.
UPDATE "SystemConfigs"
SET value = jsonb_set(
      COALESCE(jsonb_unwrap_string(value), '{}'::jsonb),
      '{FEEDBACK}',
      COALESCE(jsonb_unwrap_string(value)->'FEEDBACK', '{}'::jsonb)
        || '{"enabled": true, "label": "Khách đánh giá KTV", "allowed_roles": [], "include_target_employee": true, "require_on_shift": false}'::jsonb,
      true),
    updated_at = now()
WHERE key = 'notification_rules';
