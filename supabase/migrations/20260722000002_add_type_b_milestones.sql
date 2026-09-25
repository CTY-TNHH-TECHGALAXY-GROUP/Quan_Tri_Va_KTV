INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'ktv_commission_milestones_type_b',
    '{"1": 3600, "30": 90000, "45": 135000, "60": 180000, "70": 210000, "90": 270000, "100": 290000, "120": 360000, "180": 540000, "300": 900000}',
    'Bảng mốc tiền tua cho KTV Loại B (180k/h)'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
