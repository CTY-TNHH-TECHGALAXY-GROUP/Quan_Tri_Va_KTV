-- Seed cờ bật/tắt tính năng Báo Khách (khóa tan ca).
-- Cột "value" là JSONB: 'true' là JSON boolean hợp lệ nên viết trần được.
-- Ngược lại, chuỗi ngày/text phải bọc nháy kép, ví dụ '"2026-09-01"'.
-- DO NOTHING chứ không DO UPDATE: nếu admin đã chủ động tắt thì không bật đè lên.
INSERT INTO public."SystemConfigs" (key, value, description)
VALUES (
    'guest_arrival_lock_enabled',
    'true',
    'Kích hoạt tính năng khóa tan ca khi có khách đến'
) ON CONFLICT (key) DO NOTHING;
