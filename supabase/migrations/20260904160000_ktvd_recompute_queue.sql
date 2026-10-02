-- ================================================================
-- KTVDRecomputeQueue — hàng đợi tính lại sổ cái tua loại D
-- Kế hoạch: plans/plan_ktvd_turn_ledger.md (bước 6)
-- ================================================================
-- VÌ SAO DÙNG TRIGGER THAY VÌ CẮM HOOK VÀO CODE
--
-- Có ÍT NHẤT hai đường server ghi "tua kết thúc", và chúng không gọi nhau:
--   1. /api/ktv/booking → handleFinishService        (KTV bấm trên app KTV)
--   2. updateBookingItemStatus (dispatch/actions.ts)  (tự động hết giờ,
--      lễ tân kéo thả Kanban) ← đường chính trong vận hành
-- Ngoài ra dispatch/actions.ts đang còn sửa tiếp (sửa phút / đổi KTV / huỷ
-- đơn chưa hoàn thiện), nên hook cắm vào đó sẽ rụng lúc nào không biết.
--
-- Trigger bám vào DỮ LIỆU nên bắt được mọi đường ghi — kể cả đường viết
-- thêm sau này và cả sửa tay trực tiếp trong DB.
--
-- Trigger CHỈ nhét id vào hàng đợi (rẻ). Toàn bộ tính toán vẫn nằm trong
-- TypeScript (KtvDLedgerEngine), không nhồi nghiệp vụ vào SQL.

CREATE TABLE IF NOT EXISTS "KTVDRecomputeQueue" (
  -- PK theo item → tự khử trùng lặp. Sửa 10 lần cùng một item vẫn chỉ 1 dòng.
  "booking_item_id" TEXT PRIMARY KEY,
  "booking_id"      TEXT,
  "reason"          TEXT,          -- ITEM | GUEST | BOOKING
  "enqueued_at"     TIMESTAMPTZ DEFAULT NOW(),
  "attempts"        INTEGER DEFAULT 0,
  "last_error"      TEXT
);

CREATE INDEX IF NOT EXISTS "idx_ktvd_queue_enqueued"
  ON "KTVDRecomputeQueue" ("enqueued_at");

COMMENT ON TABLE "KTVDRecomputeQueue" IS
  'Hàng đợi item cần tính lại vào KTVDTurnLedger. Trigger đẩy vào, worker rút ra. Hàng đợi rỗng = sổ cái đã bắt kịp dữ liệu.';

ALTER TABLE "KTVDRecomputeQueue" ENABLE ROW LEVEL SECURITY;
-- Không policy nào → anon và authenticated đều bị chặn.
-- service_role bypass RLS nên worker vẫn chạy bình thường.

-- ================================================================
-- HÀM TRIGGER
-- ================================================================
-- ⚠️ MỌI hàm dưới đây đều bọc EXCEPTION WHEN OTHERS THEN NULL.
-- Hàng đợi tính lại TUYỆT ĐỐI không được làm hỏng thao tác chính: nếu ghi
-- hàng đợi lỗi mà trigger ném exception thì cả lệnh UPDATE "BookingItems"
-- sẽ fail theo, kéo sập màn hình điều phối. Sót một lần tính lại thì cron
-- đối soát đêm vá được; chặn lễ tân thao tác thì không.

CREATE OR REPLACE FUNCTION ktvd_enqueue_from_item() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
    VALUES (NEW."id", NEW."bookingId", 'ITEM')
    ON CONFLICT ("booking_item_id") DO UPDATE
        SET "enqueued_at" = NOW(), "attempts" = 0, "last_error" = NULL;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ktvd_enqueue_from_guest() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
    SELECT bi."id", bi."bookingId", 'GUEST'
    FROM "BookingItems" bi
    WHERE bi."guest_id" = NEW."id"
    ON CONFLICT ("booking_item_id") DO UPDATE
        SET "enqueued_at" = NOW(), "attempts" = 0, "last_error" = NULL;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ktvd_enqueue_from_booking() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
    SELECT bi."id", bi."bookingId", 'BOOKING'
    FROM "BookingItems" bi
    WHERE bi."bookingId" = NEW."id"
    ON CONFLICT ("booking_item_id") DO UPDATE
        SET "enqueued_at" = NOW(), "attempts" = 0, "last_error" = NULL;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- GẮN TRIGGER
-- ================================================================
-- Chỉ nghe những cột thực sự làm đổi tiền hoặc giờ. Cột khác đổi thì không
-- đánh thức hàng đợi.

DROP TRIGGER IF EXISTS "trg_ktvd_enqueue_item" ON "BookingItems";
CREATE TRIGGER "trg_ktvd_enqueue_item"
AFTER INSERT OR UPDATE OF
    "status",            -- xong tua / huỷ / lùi trạng thái
    "segments",          -- giờ bắt đầu-kết thúc, admin sửa phút, đổi KTV
    "technicianCodes",   -- đổi KTV
    "tip",
    "guest_id",          -- gán lại khách → đổi nguồn sao
    "options",           -- gộp đơn con (mergedIntoId)
    "itemRating",
    "ktvRatings",
    "handover_status"
ON "BookingItems"
FOR EACH ROW EXECUTE FUNCTION ktvd_enqueue_from_item();

-- Sao chấm theo KHÁCH — nguồn sao ưu tiên cao nhất.
DROP TRIGGER IF EXISTS "trg_ktvd_enqueue_guest" ON "BookingGuests";
CREATE TRIGGER "trg_ktvd_enqueue_guest"
AFTER UPDATE OF "rating", "ktv_ratings"
ON "BookingGuests"
FOR EACH ROW EXECUTE FUNCTION ktvd_enqueue_from_guest();

-- `Bookings.rating` là nguồn sao dự phòng; `timeStart` quyết định work_date.
DROP TRIGGER IF EXISTS "trg_ktvd_enqueue_booking" ON "Bookings";
CREATE TRIGGER "trg_ktvd_enqueue_booking"
AFTER UPDATE OF "rating", "timeStart", "status"
ON "Bookings"
FOR EACH ROW EXECUTE FUNCTION ktvd_enqueue_from_booking();
