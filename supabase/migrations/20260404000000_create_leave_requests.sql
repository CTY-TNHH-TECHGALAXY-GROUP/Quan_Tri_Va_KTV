-- ==========================================
-- MIGRATION: CREATE KTVLeaveRequests TABLE
-- Bảng riêng biệt để quản lý đăng ký nghỉ OFF của KTV
-- Tách biệt khỏi KTVAttendance (chỉ dùng cho check-in/check-out)
-- ==========================================

CREATE TABLE IF NOT EXISTS public."KTVLeaveRequests" (
  "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "employeeId" TEXT NOT NULL,
  "employeeName" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by date range
CREATE INDEX IF NOT EXISTS idx_leave_requests_date ON public."KTVLeaveRequests" ("date");

-- Index for fast lookup by employee
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON public."KTVLeaveRequests" ("employeeId");

-- RLS
ALTER TABLE public."KTVLeaveRequests" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read (so KTV can see each other's schedule)
CREATE POLICY "Allow authenticated read KTVLeaveRequests"
  ON public."KTVLeaveRequests"
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow all authenticated users to insert their own requests
CREATE POLICY "Allow authenticated insert KTVLeaveRequests"
  ON public."KTVLeaveRequests"
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow service_role to do everything (for API admin operations)
CREATE POLICY "Allow service_role full access KTVLeaveRequests"
  ON public."KTVLeaveRequests"
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Enable Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public."KTVLeaveRequests";
