-- 1. Thêm cột total_penalty vào bảng KTVDailyLedger
ALTER TABLE "KTVDailyLedger" ADD COLUMN IF NOT EXISTS "total_penalty" numeric DEFAULT 0;

-- 2. Thêm cấu hình mức phạt nghỉ đột xuất vào SystemConfigs (nếu chưa có)
-- Mặc định phạt 50.000đ mỗi lần nghỉ đột xuất (có thể chỉnh sửa trong Admin)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('ktv_sudden_off_penalty', '50000', 'Số tiền phạt cho mỗi lần KTV nghỉ đột xuất (VNĐ)')
ON CONFLICT (key) DO NOTHING;
