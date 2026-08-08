ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_reject_images JSONB DEFAULT '[]'::jsonb;
