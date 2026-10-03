-- ============================================================
-- Migration: Add customerLang column to Bookings
-- Lưu trữ ngôn ngữ mà khách hàng đã chọn khi đặt lịch
-- Giá trị: 'vi', 'en', 'ko', 'zh', etc.
-- ============================================================

ALTER TABLE public."Bookings" 
ADD COLUMN IF NOT EXISTS "customerLang" TEXT DEFAULT 'vi';

-- Comment for documentation
COMMENT ON COLUMN public."Bookings"."customerLang" IS 'Language code chosen by customer during booking (vi, en, ko, zh)';
