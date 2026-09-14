-- Migration: Create KTVAttendance table for GPS check-in

CREATE TABLE IF NOT EXISTS public."KTVAttendance" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "employeeId"  TEXT NOT NULL,
  "employeeName" TEXT,
  "photoUrl"    TEXT,               -- URL from Supabase Storage
  "latitude"    DOUBLE PRECISION,
  "longitude"   DOUBLE PRECISION,
  "locationText" TEXT,              -- human-readable "lat, lng" string
  "checkedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable realtime so Sổ Tua can react immediately
ALTER PUBLICATION supabase_realtime ADD TABLE public."KTVAttendance";

-- Row Level Security
ALTER TABLE public."KTVAttendance" ENABLE ROW LEVEL SECURITY;

-- Admin / service role: full access
CREATE POLICY "attendance_admin_all"
  ON public."KTVAttendance"
  FOR ALL
  USING (true);

-- KTV: read own records only
CREATE POLICY "attendance_ktv_own"
  ON public."KTVAttendance"
  FOR SELECT
  USING (auth.uid()::text = "employeeId");
