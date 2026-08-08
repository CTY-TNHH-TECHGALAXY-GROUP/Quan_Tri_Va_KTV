-- Migration: Add pauseStart to BookingItems and is_punished to TurnLedger

-- 1. Add pauseStart to BookingItems
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS "pauseStart" timestamptz;

-- 2. Add is_punished to TurnLedger
ALTER TABLE "TurnLedger" ADD COLUMN IF NOT EXISTS "is_punished" boolean DEFAULT false;

-- (Optional) We don't need to add PAUSED to BookingStatus enum if it is not used in Bookings.status.
-- BookingItems.status is just text, so 'PAUSED' is valid.
