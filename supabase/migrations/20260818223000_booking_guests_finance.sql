-- Thêm các cột tài chính và CRM vào bảng BookingGuests
-- Để hỗ trợ mô hình Invoice-per-Guest (Thanh toán theo khách)

ALTER TABLE "BookingGuests" 
    ADD COLUMN IF NOT EXISTS "total_amount" numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "payment_method" text,
    ADD COLUMN IF NOT EXISTS "tip_amount" numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "customer_phone" text,
    ADD COLUMN IF NOT EXISTS "reception_feedback" text,
    ADD COLUMN IF NOT EXISTS "checkout_status" text DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS "checkout_time" timestamptz;

-- (TUYỆT ĐỐI KHÔNG DÙNG LỆNH CẬP NHẬT DỮ LIỆU CŨ ĐỂ BẢO VỆ TÀI CHÍNH QUÁ KHỨ THEO CHIẾN LƯỢC ZERO-TOUCH OLD DATA)
