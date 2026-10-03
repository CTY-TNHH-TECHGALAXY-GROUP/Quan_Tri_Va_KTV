-- ============================================================
-- Migration: Add feature_flags column to Staff table
-- Date: 2026-05-27
-- Purpose: Per-staff feature flags for laundry deduction, sudden leave penalty, etc.
-- ============================================================

-- 1. Add feature_flags column to Staff
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "feature_flags" jsonb DEFAULT '{}';

-- 2. Enable laundry_deduction & sudden_leave_penalty for test KTVs
UPDATE "Staff" SET "feature_flags" = '{"laundry_deduction": true, "sudden_leave_penalty": true}'
WHERE id IN ('NH007', 'NH016', 'NH079', 'NH069');

-- 3. Add laundry_fee config (default 20,000 VND)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('laundry_fee', '20000', 'Phí giặt đồ mỗi ngày điểm danh (VNĐ)')
ON CONFLICT (key) DO NOTHING;

-- Note: ktv_sudden_off_penalty already exists in SystemConfigs (default 500,000 VND)
