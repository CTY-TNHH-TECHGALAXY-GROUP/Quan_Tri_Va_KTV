-- Add tip column to Bookings table
ALTER TABLE public."Bookings"
  ADD COLUMN IF NOT EXISTS "tip" NUMERIC(12, 0) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."Bookings"."tip" IS 'Tiền tip (tip) khách tặng cho nhân viên, nhập tại quầy khi thanh toán.';
