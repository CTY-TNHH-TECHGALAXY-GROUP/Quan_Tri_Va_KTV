-- Migration: Add status column to KTVAttendance for admin approval flow
-- status: PENDING | CONFIRMED | REJECTED

ALTER TABLE public."KTVAttendance"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "checkType" TEXT NOT NULL DEFAULT 'CHECK_IN',
  ADD COLUMN IF NOT EXISTS "confirmedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMPTZ;

-- Enable realtime so KTV page reacts immediately when admin confirms
ALTER PUBLICATION supabase_realtime ADD TABLE public."KTVAttendance";
