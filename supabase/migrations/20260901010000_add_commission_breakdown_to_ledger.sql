-- Lưu chi tiết từng tua (item) khi sync-daily-ledger tính total_commission,
-- để truy vết được lúc có sai lệch mà không phải suy luận ngược như sự cố NH027 29/08/2026.
ALTER TABLE "KTVDailyLedger" ADD COLUMN IF NOT EXISTS "commission_breakdown" JSONB DEFAULT NULL;
