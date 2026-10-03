-- Migration: Add maintenance fee configs to SystemConfigs
-- Date: 2026-07-25
-- Purpose: Tự động trừ phí bảo trì app hàng tháng cho KTV

-- 1. Enable maintenance fee (global toggle)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'enable_maintenance_fee',
    'false',
    'Bật/tắt tính năng tự động trừ phí bảo trì hệ thống hàng tháng cho KTV'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Maintenance fee amount (default 50000)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'maintenance_fee_amount',
    '"50000"',
    'Số tiền phí bảo trì hệ thống trừ hàng tháng (VND)'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Allow deducting from deposit (tiền cọc)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'maintenance_fee_deduct_deposit',
    'false',
    'Cho phép trừ phí bảo trì vào tiền cọc nếu ví không đủ'
)
ON CONFLICT (key) DO NOTHING;
