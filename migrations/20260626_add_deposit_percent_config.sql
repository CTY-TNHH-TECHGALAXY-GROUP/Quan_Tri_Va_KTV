-- Migration: Thêm cấu hình tỷ lệ phần trăm tiền cọc cho Web Booking
-- Mục đích: Tính toán số tiền cọc (VD: 40%) từ tổng bill để hiển thị trong Email xác nhận.

INSERT INTO "SystemConfigs" (key, value, description) 
VALUES ('web_booking_deposit_percent', '40', 'Tỷ lệ phần trăm tiền cọc bắt buộc cho Web Booking (VD: 40).')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
