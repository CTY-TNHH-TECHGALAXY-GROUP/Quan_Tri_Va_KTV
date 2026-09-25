-- Thêm cột cho quy trình duyệt ảnh bàn giao phòng
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_status TEXT DEFAULT 'PENDING' CHECK (handover_status IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_comment TEXT;

-- Bổ sung feedback nội bộ của quầy cho KTV (nếu cần trên toàn booking)
ALTER TABLE "Bookings" ADD COLUMN IF NOT EXISTS reception_feedback TEXT;
