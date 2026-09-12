CREATE TABLE "KTVMonthlyLedger" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    total_commission NUMERIC DEFAULT 0,
    total_tip NUMERIC DEFAULT 0,
    total_bonus NUMERIC DEFAULT 0,
    total_penalty NUMERIC DEFAULT 0,
    total_bookings INTEGER DEFAULT 0,
    total_minutes INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, month, year)
);

CREATE INDEX idx_ktv_monthly_ledger_staff_id ON "KTVMonthlyLedger"(staff_id);

CREATE TABLE "KTVYearlyLedger" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    total_commission NUMERIC DEFAULT 0,
    total_tip NUMERIC DEFAULT 0,
    total_bonus NUMERIC DEFAULT 0,
    total_penalty NUMERIC DEFAULT 0,
    total_bookings INTEGER DEFAULT 0,
    total_minutes INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, year)
);

CREATE INDEX idx_ktv_yearly_ledger_staff_id ON "KTVYearlyLedger"(staff_id);
