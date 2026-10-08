-- "Vẫn còn khách" on the dispatch board's guest-arrival reminder: when the
-- next reminder is due, shared by every front-desk device. NULL = not snoozed
-- (next reminder = created_at + guest_arrival_reminder_minutes).
-- Additive nullable column only; GuestArrivalEvents is already in supabase_realtime.
ALTER TABLE "GuestArrivalEvents" ADD COLUMN IF NOT EXISTS reminder_snoozed_until timestamptz NULL;
