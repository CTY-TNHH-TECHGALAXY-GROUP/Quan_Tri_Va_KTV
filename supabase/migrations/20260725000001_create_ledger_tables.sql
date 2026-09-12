-- Bảng KTVMonthlyLedger (Cuốn Tháng)
CREATE TABLE IF NOT EXISTS "KTVMonthlyLedger" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id TEXT NOT NULL,
    month INTEGER NOT NULL,        -- VD: 7
    year INTEGER NOT NULL,         -- VD: 2026
    total_commission NUMERIC DEFAULT 0,
    total_tip NUMERIC DEFAULT 0,
    total_bonus NUMERIC DEFAULT 0,
    total_penalty NUMERIC DEFAULT 0,
    total_bookings INTEGER DEFAULT 0,
    total_minutes INTEGER DEFAULT 0,   -- Tổng phút làm tua (dùng cho KPI Loại B)
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, month, year)
);

-- Bảng KTVYearlyLedger (Cuốn Năm)
CREATE TABLE IF NOT EXISTS "KTVYearlyLedger" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id TEXT NOT NULL,
    year INTEGER NOT NULL,         -- VD: 2026
    total_commission NUMERIC DEFAULT 0,
    total_tip NUMERIC DEFAULT 0,
    total_bonus NUMERIC DEFAULT 0,
    total_penalty NUMERIC DEFAULT 0,
    total_bookings INTEGER DEFAULT 0,
    total_minutes INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, year)
);
