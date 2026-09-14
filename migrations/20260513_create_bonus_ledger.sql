-- Migration: Tạo bảng KTVBonusLedger + Feature Flag
-- Ngày: 2026-05-13
-- Mục đích: Ví điểm bonus riêng cho KTV

-- 1. Bảng ghi nhận lịch sử điểm bonus KTV
CREATE TABLE IF NOT EXISTS "KTVBonusLedger" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id TEXT NOT NULL,
    booking_id TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'EARN',
    description TEXT,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index cho truy vấn theo staff
CREATE INDEX IF NOT EXISTS idx_bonus_ledger_staff ON "KTVBonusLedger" (staff_id);
-- Index cho truy vấn theo ngày
CREATE INDEX IF NOT EXISTS idx_bonus_ledger_date ON "KTVBonusLedger" (date);
-- Unique: mỗi KTV chỉ nhận bonus 1 lần per booking (chỉ cho type = EARN)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_ledger_unique 
    ON "KTVBonusLedger" (staff_id, booking_id) WHERE type = 'EARN';

-- 2. Feature flag: bật/tắt ví điểm bonus
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('enable_bonus_wallet', '"false"', 'Bật/tắt tính năng ví điểm bonus KTV')
ON CONFLICT (key) DO NOTHING;
