-- ================================================================
-- KTVDTurnLedger + KTVDPenaltyLedger — sổ cái tua loại D
-- Kế hoạch: plans/plan_ktvd_turn_ledger.md (bước 3)
-- ================================================================
-- CHỈ TẠO BẢNG MỚI. Không sửa, không xoá bảng nào đang chạy.
-- Đường lùi: DROP TABLE cả hai bảng — không mất dữ liệu gì khác.
--
-- Sau khi 2 bảng này thành nguồn sự thật (bước 5), các bảng sau sẽ được
-- gỡ dần: KTVServiceHoursLedger, KTVMonthlyServiceHours.

-- ================================================================
-- 1. KTVDTurnLedger — NGUỒN SỰ THẬT cho tiền tua & giờ loại D
-- ================================================================
-- Grain: 1 dòng = 1 KTV × 1 BookingItem.
--
-- Sửa 2 lỗi thiết kế của KTVServiceHoursLedger:
--   · Grain cũ UNIQUE(staff_id, date, booking_id) = 1 KTV/1 bill/1 dòng
--     → không lưu được service_id từng đơn con (L9).
--   · Unique index cũ là PARTIAL → Postgres từ chối ON CONFLICT, buộc phải
--     insert từng dòng rồi bắt lỗi 23505 (L10). Ở đây index TOÀN PHẦN nên
--     upsert chạy bình thường.

CREATE TABLE IF NOT EXISTS "KTVDTurnLedger" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── KHOÁ ──────────────────────────────────────────────────────
  "staff_id"           TEXT NOT NULL,
  "booking_item_id"    TEXT NOT NULL,
  "booking_id"         TEXT NOT NULL,
  "guest_id"           TEXT,           -- BookingGuests.id — "khách"
  "group_id"           TEXT NOT NULL,  -- options.mergedIntoId || item.id — "đơn con"
  "work_date"          DATE NOT NULL,  -- NGÀY LÀM VIỆC theo spa_day_cutoff_hours

  -- ── SNAPSHOT HIỂN THỊ (lịch sử khỏi join Bookings/Services) ────
  "bill_code"          TEXT,
  "bill_suffix"        TEXT DEFAULT '',  -- '-A' / '-B' theo khách
  "service_id"         TEXT,
  "service_name"       TEXT,
  "rate_category"      TEXT,             -- 'VIP' | 'PT'
  "booking_time_start" TIMESTAMP,

  -- ── THỜI GIAN ─────────────────────────────────────────────────
  -- ⚠️ paid ≠ actual, và đây là CHỦ Ý (xem plan §7.2):
  --    paid   : phút LẺ, mốc lỗi trả 0, = min(thực, gán)   → TIỀN
  --    actual : phút LÀM TRÒN, mốc lỗi lùi về giờ gán      → GIỜ TÍCH LŨY
  -- Gộp chung là tự ý đổi lương hoặc đổi thứ hạng của KTV.
  "assigned_minutes"   NUMERIC DEFAULT 0,
  "actual_minutes"     NUMERIC DEFAULT 0,
  "paid_minutes"       NUMERIC DEFAULT 0,
  "custom_minutes"     NUMERIC,          -- admin can thiệp, NULL nếu không

  -- ── TIỀN ──────────────────────────────────────────────────────
  "rate_per_60m"       NUMERIC NOT NULL, -- SNAPSHOT: admin đổi giá KHÔNG tính lại quá khứ
  "rating_used"        INTEGER,
  "rating_source"      TEXT,             -- GUEST_KTV|GUEST|ITEM_KTV|ITEM|BOOKING|NONE
  "deduction_rate"     NUMERIC DEFAULT 0,
  "commission_gross"   NUMERIC DEFAULT 0, -- trước trừ sao
  "commission_net"     NUMERIC DEFAULT 0, -- sau trừ sao → VÍ TUA
  "tax_amount"         NUMERIC DEFAULT 0, -- thuế TNCN của chính dòng này
  "tip"                NUMERIC DEFAULT 0,

  -- ── TRẠNG THÁI ────────────────────────────────────────────────
  "item_status"        TEXT,
  "is_provisional"     BOOLEAN DEFAULT TRUE,  -- chưa có sao & chưa chốt → chưa hiện tiền
  "entry_status"       TEXT NOT NULL DEFAULT 'OPEN',
  "locked_at"          TIMESTAMPTZ,

  -- ── PHỤ TRỢ HIỂN THỊ ──────────────────────────────────────────
  "handover_status"    TEXT,
  "handover_comment"   TEXT,
  "co_workers"         TEXT[],

  -- ── TRUY VẾT ──────────────────────────────────────────────────
  "source"             TEXT,             -- EVENT|CRON|BACKFILL|ADMIN_ADJUST
  "computed_at"        TIMESTAMPTZ DEFAULT NOW(),
  "created_at"         TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT "chk_ktvd_turn_entry_status"
    CHECK ("entry_status" IN ('OPEN', 'FINAL', 'LOCKED', 'VOID')),
  CONSTRAINT "chk_ktvd_turn_rate_category"
    CHECK ("rate_category" IS NULL OR "rate_category" IN ('VIP', 'PT'))
);

-- Index TOÀN PHẦN → upsert(onConflict) dùng được, không phải bắt lỗi 23505.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ktvd_turn"
  ON "KTVDTurnLedger" ("staff_id", "booking_item_id");

-- Đường đọc chính: lịch sử / ví / giờ tích lũy đều lọc theo (KTV, khoảng ngày).
CREATE INDEX IF NOT EXISTS "idx_ktvd_turn_staff_date"
  ON "KTVDTurnLedger" ("staff_id", "work_date");

-- Cron lưới an toàn + báo cáo admin quét theo ngày.
CREATE INDEX IF NOT EXISTS "idx_ktvd_turn_date"
  ON "KTVDTurnLedger" ("work_date");

-- Tra ngược khi cần recompute theo đơn.
CREATE INDEX IF NOT EXISTS "idx_ktvd_turn_booking"
  ON "KTVDTurnLedger" ("booking_id");

COMMENT ON TABLE  "KTVDTurnLedger" IS
  'Sổ cái tua loại D. NGUỒN SỰ THẬT cho tiền tua và giờ tích lũy. Mọi consumer (ví, lịch sử, xếp tua, báo cáo) phải đọc từ đây, không được tự tính lại từ Bookings.';
COMMENT ON COLUMN "KTVDTurnLedger"."work_date" IS
  'Ngày làm việc theo spa_day_cutoff_hours (KHÔNG phải ngày lịch của timeStart). Tính bằng lib/business-date.ts toBusinessDate().';
COMMENT ON COLUMN "KTVDTurnLedger"."paid_minutes" IS
  'Phút được trả tiền: phút LẺ, min(thực, gán), mốc lỗi trả 0. Khác actual_minutes — xem plan §7.2.';
COMMENT ON COLUMN "KTVDTurnLedger"."actual_minutes" IS
  'Phút làm thực cho giờ tích lũy: phút LÀM TRÒN, không chặn trên, mốc lỗi lùi về giờ gán.';
COMMENT ON COLUMN "KTVDTurnLedger"."rate_per_60m" IS
  'Snapshot đơn giá lúc chốt. Admin đổi giá trong Settings KHÔNG làm thay đổi các dòng đã ghi.';
COMMENT ON COLUMN "KTVDTurnLedger"."entry_status" IS
  'OPEN = chưa chốt · FINAL = item DONE, giờ+sao đã đủ · LOCKED = đã khoá sổ, cấm sửa đè (mọi thay đổi phải ghi dòng ADMIN_ADJUST mới) · VOID = đơn bị huỷ sau khi đã ghi.';

-- ================================================================
-- 2. KTVDPenaltyLedger — phạt (giờ / tiền) và dấu mốc kỷ luật
-- ================================================================
-- Tách riêng vì phạt KHÔNG gắn với BookingItem nào. Trộn 2 loại dòng vào
-- một bảng chính là lỗi thiết kế của KTVServiceHoursLedger — nó đẻ ra 2
-- partial unique index và khiến upsert không dùng được.

CREATE TABLE IF NOT EXISTS "KTVDPenaltyLedger" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id"      TEXT NOT NULL,
  "work_date"     DATE NOT NULL,
  "penalty_type"  TEXT NOT NULL,      -- LATE_NO_UPDATE | ORDER_REJECT | ACCOUNT_LOCK | ...
  "hours_penalty" NUMERIC DEFAULT 0,  -- trừ giờ tích lũy
  "money_penalty" NUMERIC DEFAULT 0,  -- trừ ví (nếu sau này cần)
  "note"          TEXT,
  "created_by"    TEXT,
  "created_at"    TIMESTAMPTZ DEFAULT NOW()
);

-- Toàn phần → upsert được, chống phạt trùng 1 loại lỗi trong ngày.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ktvd_penalty"
  ON "KTVDPenaltyLedger" ("staff_id", "work_date", "penalty_type");

CREATE INDEX IF NOT EXISTS "idx_ktvd_penalty_date"
  ON "KTVDPenaltyLedger" ("work_date");

COMMENT ON TABLE  "KTVDPenaltyLedger" IS
  'Phạt và dấu mốc kỷ luật loại D. Tách khỏi KTVDTurnLedger vì không gắn với BookingItem nào.';
COMMENT ON COLUMN "KTVDPenaltyLedger"."penalty_type" IS
  'ACCOUNT_LOCK ghi với hours_penalty = 0 — là DẤU MỐC để lịch sử ngày-theo-ngày còn vết sau khi tài khoản đã được mở khoá, không phải một khoản phạt.';

-- ================================================================
-- 3. RLS
-- ================================================================
-- ⚠️ CỐ Ý KHÁC các bảng sổ cái cũ. KTVDailyLedger / TurnLedger / KTVWithdrawals
-- đang có policy `FOR ALL TO public USING (true) WITH CHECK (true)` — tức là
-- bất kỳ ai cầm anon key (key này nằm sẵn trong JS phía client) đều ĐỌC, GHI,
-- XOÁ được. KTVServiceHoursLedger thì không bật RLS.
--
-- Hai bảng này chỉ được ghi/đọc bởi API server dùng SUPABASE_SECRET_KEY,
-- mà service_role vốn BYPASSRLS — nên siết chặt không làm hỏng luồng nào:
--   · anon           → không có policy → chặn hoàn toàn
--   · authenticated  → chỉ SELECT (cho trang admin đọc trực tiếp nếu cần)
--   · service_role   → bypass, toàn quyền

ALTER TABLE "KTVDTurnLedger"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KTVDPenaltyLedger" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ktvd_turn_read_authenticated" ON "KTVDTurnLedger";
CREATE POLICY "ktvd_turn_read_authenticated"
  ON "KTVDTurnLedger" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ktvd_penalty_read_authenticated" ON "KTVDPenaltyLedger";
CREATE POLICY "ktvd_penalty_read_authenticated"
  ON "KTVDPenaltyLedger" FOR SELECT TO authenticated USING (true);
