-- Thêm cột is_extension và is_sudden_off vào KTVLeaveRequests
ALTER TABLE "KTVLeaveRequests" 
ADD COLUMN IF NOT EXISTS "is_extension" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "is_sudden_off" boolean DEFAULT false;

-- Insert cấu hình mặc định (nếu chưa có)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'max_leave_extensions_per_month', 
    '1'::jsonb, 
    'Số lần tối đa KTV được gia hạn ngày nghỉ (đăng ký nối tiếp) trong 1 tháng'
)
ON CONFLICT (key) DO NOTHING;
