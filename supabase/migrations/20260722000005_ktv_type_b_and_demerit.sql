CREATE TABLE IF NOT EXISTS "KtvDemeritPoints" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id TEXT NOT NULL,
    booking_id UUID,
    service_id UUID,
    rating INTEGER NOT NULL,
    feedback_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    status TEXT DEFAULT 'ACTIVE' -- ACTIVE, RESET
);

CREATE INDEX IF NOT EXISTS idx_ktv_demerit_staff_id ON "KtvDemeritPoints"(staff_id);

INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'ktv_type_b_enabled',
    'false',
    'Công tắc tổng (Global Toggle) bật/tắt tính năng phân hạng KTV Loại B (180k/h).'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'ktv_demotion_settings',
    '{"enabled": false, "warning_threshold": 3, "demotion_threshold": 5, "reset_interval_days": 30}',
    'Cấu hình tự động giáng cấp KTV Loại B xuống Loại A khi có nhiều đánh giá tệ (<= 2 sao).'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
