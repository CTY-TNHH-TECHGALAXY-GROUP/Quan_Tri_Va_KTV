-- Tip is per-KTV (per BookingItem), not per Booking
ALTER TABLE public."BookingItems"
  ADD COLUMN IF NOT EXISTS "tip" NUMERIC(12, 0) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."BookingItems"."tip" IS 'Tiền tip khách tặng cho KTV phụ trách dịch vụ này.';
