-- ==========================================
-- MIGRATION: CREATE KTVShifts TABLE
-- Quản lý ca làm việc của KTV
-- Ca 1: 09:00 - 17:00
-- Ca 2: 11:00 - 19:00
-- Ca 3: 17:00 - 00:00 (midnight)
-- ==========================================

CREATE TABLE IF NOT EXISTS public."KTVShifts" (
  "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "employeeId" TEXT NOT NULL,
  "employeeName" TEXT NOT NULL,
  "shiftType" TEXT NOT NULL CHECK ("shiftType" IN ('SHIFT_1', 'SHIFT_2', 'SHIFT_3')),
  "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_DATE,
  "previousShift" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'PENDING', 'APPROVED', 'REJECTED', 'REPLACED')),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by employee + status
CREATE INDEX IF NOT EXISTS idx_shifts_employee_status ON public."KTVShifts" ("employeeId", "status");

-- Index for pending requests (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_shifts_pending ON public."KTVShifts" ("status") WHERE "status" = 'PENDING';

-- RLS
ALTER TABLE public."KTVShifts" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "Allow authenticated read KTVShifts"
  ON public."KTVShifts"
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow all authenticated users to insert (KTV can request shift change)
CREATE POLICY "Allow authenticated insert KTVShifts"
  ON public."KTVShifts"
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow service_role full access (for API admin operations)
CREATE POLICY "Allow service_role full access KTVShifts"
  ON public."KTVShifts"
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Enable Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public."KTVShifts";
