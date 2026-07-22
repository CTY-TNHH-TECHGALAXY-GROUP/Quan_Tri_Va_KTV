-- Create KTVDailyLedger table for snapshotting daily earnings
CREATE TABLE IF NOT EXISTS "KTVDailyLedger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "date" date NOT NULL,
    "staff_id" text NOT NULL,
    "total_commission" numeric NOT NULL DEFAULT 0,
    "total_tip" numeric NOT NULL DEFAULT 0,
    "total_adjustment" numeric NOT NULL DEFAULT 0,
    "total_withdrawn" numeric NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    UNIQUE("date", "staff_id")
);

-- Enable RLS but allow authenticated users to read (or keep it open if admin only)
ALTER TABLE "KTVDailyLedger" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "Allow authenticated to read KTVDailyLedger"
ON "KTVDailyLedger"
FOR SELECT
TO authenticated
USING (true);

-- Allow service role to do everything
CREATE POLICY "Allow service role all on KTVDailyLedger"
ON "KTVDailyLedger"
USING (true)
WITH CHECK (true);

-- Add index on staff_id and date for fast querying
CREATE INDEX IF NOT EXISTS "idx_ktvdailyledger_staff_date" ON "KTVDailyLedger"("staff_id", "date");
