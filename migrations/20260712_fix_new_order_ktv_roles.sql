-- Migration: Remove KTV role from NEW_ORDER and KTV_NEW_ORDER allowed_roles
-- Reason: To prevent KTVs from receiving broadcast notifications for unassigned web bookings 
-- and prevent KTVs from broadcasting assignment notifications to ALL KTVs on shift.

UPDATE "SystemConfigs"
SET value = jsonb_set(
    value, 
    '{NEW_ORDER, allowed_roles}', 
    '["admin", "reception", "dev"]'::jsonb
)
WHERE key = 'notification_rules';

UPDATE "SystemConfigs"
SET value = jsonb_set(
    value, 
    '{KTV_NEW_ORDER, allowed_roles}', 
    '[]'::jsonb
)
WHERE key = 'notification_rules';
