-- ================================================
-- PHASE 0: MỞ CHECK CONSTRAINT work_type  ⚠️ BẮT BUỘC — LÀM ĐẦU TIÊN
-- ================================================
-- Lý do: supabase/migrations/20260722000001_add_work_type_to_staff.sql đã khoá cứng
--   CHECK (work_type IN ('TYPE_A','TYPE_B','TYPE_C'))
-- ở tầng DATABASE. Nếu không mở, mọi lệnh ghi work_type = 'TYPE_D' đều bị Postgres
-- từ chối với lỗi:
--   new row for relation "Staff" violates check constraint "check_work_type"
-- → Phase 0 (seed 11 tài khoản test T001–T079) fail ngay dòng đầu tiên,
--   dù code TypeScript đã sửa đủ.
-- Postgres không cho sửa CHECK tại chỗ → phải DROP rồi ADD lại.

ALTER TABLE "Staff" DROP CONSTRAINT IF EXISTS check_work_type;
ALTER TABLE "Staff" ADD CONSTRAINT check_work_type
  CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'));

-- ================================================
-- PHASE A: TEMPORAL TAGGING (4 bảng ledger)
-- ================================================
ALTER TABLE "KTVDailyLedger"    ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;
ALTER TABLE "KTVBonusLedger"    ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;
ALTER TABLE "WalletAdjustments" ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;
ALTER TABLE "KTVWithdrawals"    ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;

-- ================================================
-- PHASE B: ĐÃ BỎ — không thêm cột vào TurnQueue
-- Lý do: dùng JOIN sang KTVServiceHoursLedger lúc đọc (xem §2.4)
-- ================================================

-- ================================================
-- PHASE C: RATING DEDUCTION
-- ================================================
ALTER TABLE "KTVDailyLedger"
  ADD COLUMN IF NOT EXISTS "rating_deduction" NUMERIC DEFAULT 0;

-- ================================================
-- PHASE D: Sổ kỷ luật giờ tích lũy TYPE_D
-- ================================================
CREATE TABLE IF NOT EXISTS "KTVServiceHoursLedger" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "hours_earned" NUMERIC DEFAULT 0,
  "hours_penalty" NUMERIC DEFAULT 0,
  "penalty_type" TEXT,
  "booking_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_svc_hours_ledger_unique" 
  ON "KTVServiceHoursLedger" ("staff_id", "date", "booking_id") 
  WHERE "booking_id" IS NOT NULL;

-- Idempotency cho dòng PHẠT: các dòng phạt có booking_id = NULL nên KHÔNG rơi vào
-- index bên trên → gọi deductHours() 2 lần sẽ trừ giờ 2 lần. Cần index riêng.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_svc_hours_ledger_penalty_unique"
  ON "KTVServiceHoursLedger" ("staff_id", "date", "penalty_type")
  WHERE "booking_id" IS NULL AND "penalty_type" IS NOT NULL;

-- ================================================
-- PHASE E: Tổng giờ tích lũy TYPE_D theo tháng
-- ================================================
CREATE TABLE IF NOT EXISTS "KTVMonthlyServiceHours" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" TEXT NOT NULL,
  "month" INT NOT NULL,
  "year" INT NOT NULL,
  "total_hours_earned" NUMERIC DEFAULT 0,
  "total_hours_penalty" NUMERIC DEFAULT 0,
  "net_hours" NUMERIC DEFAULT 0,
  "synced_at" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("staff_id", "month", "year")
);

-- ================================================
-- PHASE F: MỐC BẮT ĐẦU CHẾ ĐỘ  ⚠️ [BỔ SUNG 31/08]
-- ================================================
-- Bắt buộc để thực hiện §14 câu 12: "chuyển chế độ → giờ tích lũy reset về 0".
-- Không có cột này thì query §2.4 sẽ cộng cả giờ KTV làm ở chế độ trước đó
-- → kẽ hở chuyển ra/vào để giữ hạng vẫn còn nguyên.
ALTER TABLE "Staff"
  ADD COLUMN IF NOT EXISTS "work_type_effective_from" DATE DEFAULT NULL;

-- Backfill cho dữ liệu cũ: coi như đã ở chế độ hiện tại từ rất lâu
UPDATE "Staff" SET "work_type_effective_from" = '2020-01-01'
  WHERE "work_type_effective_from" IS NULL;
