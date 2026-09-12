-- Migration: Create KTV Piggy Bank (Ví Tích Lũy)
-- Date: 2026-07-04

-- 1. Create KTVPiggyBank table
CREATE TABLE IF NOT EXISTS "KTVPiggyBank" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id text NOT NULL REFERENCES "Staff"(id) ON DELETE CASCADE,
    weekly_amount numeric NOT NULL DEFAULT 0 CHECK (weekly_amount >= 0),
    contributed_weeks integer NOT NULL DEFAULT 0 CHECK (contributed_weeks >= 0),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Index for fast lookup by KTV
CREATE INDEX IF NOT EXISTS idx_ktv_piggy_bank_staff_id ON "KTVPiggyBank"(staff_id);

-- Enable RLS
ALTER TABLE "KTVPiggyBank" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for KTVPiggyBank" ON "KTVPiggyBank";
CREATE POLICY "Enable all for KTVPiggyBank" ON "KTVPiggyBank" FOR ALL USING (true) WITH CHECK (true);

-- 2. Create KTVPiggyBankLedger table
CREATE TABLE IF NOT EXISTS "KTVPiggyBankLedger" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id text NOT NULL REFERENCES "Staff"(id) ON DELETE CASCADE,
    amount numeric NOT NULL,
    type text NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAW', 'ADJUST')),
    note text,
    created_at timestamptz DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_ktv_piggy_bank_ledger_staff_id ON "KTVPiggyBankLedger"(staff_id);

-- Enable RLS
ALTER TABLE "KTVPiggyBankLedger" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for KTVPiggyBankLedger" ON "KTVPiggyBankLedger";
CREATE POLICY "Enable all for KTVPiggyBankLedger" ON "KTVPiggyBankLedger" FOR ALL USING (true) WITH CHECK (true);

-- 3. Add Config to SystemConfigs
INSERT INTO "SystemConfigs" (id, key, value, description)
VALUES (
    gen_random_uuid(),
    'ktv_piggy_bank_total_weeks',
    '72',
    'Tổng số tuần tích lũy mục tiêu của Ví Heo Đất (Ví Tích Lũy)'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
