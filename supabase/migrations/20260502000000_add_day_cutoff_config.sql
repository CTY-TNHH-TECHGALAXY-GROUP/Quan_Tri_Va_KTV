-- Migration to add spa_day_cutoff_hours configuration
-- This setting controls the "day cut-off time" for KTV shifts and attendance
-- Default: 6 (06:00 AM)

INSERT INTO "SystemConfigs" ("key", "value", "description")
VALUES (
    'spa_day_cutoff_hours', 
    '6'::jsonb, 
    'Giờ cắt ngày (Day Cut-off Time). Mọi hành động điểm danh trước giờ này sẽ được tính vào ngày làm việc hôm trước. VD: 6 = 06:00 sáng.'
)
ON CONFLICT ("key") DO UPDATE 
SET "value" = EXCLUDED."value",
    "description" = EXCLUDED."description",
    "updated_at" = now();
