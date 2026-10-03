CREATE TABLE IF NOT EXISTS "KTVDailyRegistration" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "expected_time" TIME,
  "registered_at" TIMESTAMPTZ DEFAULT NOW(),
  "status" TEXT DEFAULT 'REGISTERED',
  "absent_reported_at" TIMESTAMPTZ,
  "late_reported_at" TIMESTAMPTZ,
  "late_expected_time" TIME,
  "late_report_count" INT DEFAULT 0,
  "check_in_at" TIMESTAMPTZ,
  "penalty_applied" TEXT,
  UNIQUE("staff_id", "work_date")
);

-- RLS policies
ALTER TABLE "KTVDailyRegistration" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated users" ON "KTVDailyRegistration"
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
