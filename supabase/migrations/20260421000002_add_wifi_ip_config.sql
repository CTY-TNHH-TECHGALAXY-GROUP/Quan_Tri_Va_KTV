-- Script thêm cấu hình dải IP hợp lệ cho Spa
-- Bảng: SystemConfigs

INSERT INTO "SystemConfigs" (id, key, value, description, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'spa_wifi_ips',
    '["14.191.222.244", "14.191.216.9"]'::jsonb, -- Cấu hình 2 đường truyền IP của Spa
    'Danh sách Public IP mạng Wi-Fi của Spa (Dùng để xác thực điểm danh). Dạng mảng chuỗi, vd: ["113.160.100.222", "14.241.111.11"]',
    now(),
    now()
)
ON CONFLICT (key) DO NOTHING;
