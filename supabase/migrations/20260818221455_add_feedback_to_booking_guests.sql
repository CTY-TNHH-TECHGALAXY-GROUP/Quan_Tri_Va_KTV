-- Add feedback columns to BookingGuests
ALTER TABLE "BookingGuests"
ADD COLUMN IF NOT EXISTS ktv_ratings jsonb,
ADD COLUMN IF NOT EXISTS rating numeric,
ADD COLUMN IF NOT EXISTS guest_feedback text;
