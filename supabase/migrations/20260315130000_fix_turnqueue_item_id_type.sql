-- Migration: Fix booking_item_id type in TurnQueue to match BookingItems.id (TEXT)
ALTER TABLE public."TurnQueue" ALTER COLUMN "booking_item_id" TYPE TEXT;
