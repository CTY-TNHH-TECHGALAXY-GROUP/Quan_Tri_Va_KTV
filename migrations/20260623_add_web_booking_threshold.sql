-- 1. Thêm cột isWebBooking vào bảng Bookings
ALTER TABLE "Bookings" ADD COLUMN IF NOT EXISTS "isWebBooking" boolean DEFAULT false;

-- 2. Đánh chỉ mục (Index) để tăng tốc độ truy vấn cực nhanh (O(1))
CREATE INDEX IF NOT EXISTS "idx_bookings_customerPhone_isWebBooking" 
ON "Bookings"("customerPhone", "isWebBooking");

-- 3. Thêm cấu hình số đơn tối thiểu để khách không cần cọc vào SystemConfigs (Mặc định: 1 đơn)
INSERT INTO "SystemConfigs" (key, value, description) 
VALUES ('web_booking_trusted_threshold', '1', 'Số đơn đặt lịch qua web thành công tối thiểu để khách hàng trở thành khách quen (không yêu cầu thanh toán trước).')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;
