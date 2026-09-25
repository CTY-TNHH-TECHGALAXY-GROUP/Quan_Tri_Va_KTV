-- Migration: Enable Realtime for BookingItems and TurnQueue tables
-- This is critical for co-worker synchronization
ALTER PUBLICATION supabase_realtime ADD TABLE public."BookingItems";
ALTER PUBLICATION supabase_realtime ADD TABLE public."TurnQueue";
