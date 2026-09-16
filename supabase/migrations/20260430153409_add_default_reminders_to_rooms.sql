-- Thêm cột default_reminders vào bảng Rooms để lưu danh sách ID nhắc nhở mặc định
ALTER TABLE public."Rooms" 
ADD COLUMN IF NOT EXISTS "default_reminders" jsonb DEFAULT '[]'::jsonb;

-- Cập nhật mô tả (nếu cần) hoặc comment cho cột
COMMENT ON COLUMN public."Rooms"."default_reminders" IS 'Danh sách các UUID/ID từ bảng Reminders được gán mặc định cho phòng này';
