-- =====================================================================================
-- PRODUCTION — BƯỚC 0: dọn phân công KTV cũ còn "sống" trước khi chạy
--   plans/sql_production_migrate_test_vao_phase1_20261004.sql
-- Ngày soạn: 04/10/2026. Lý do: bước [0] của file migrate báo
--   "Có 14 cặp phân công ACTIVE/QUEUED/READY chồng giờ" (và còn dòng thiếu/sai giờ).
-- Đọc production (chỉ đọc) lúc 04/10 ~05:00: 324 dòng ACTIVE/QUEUED/READY, TẤT CẢ thuộc ngày làm việc
-- đã qua hoặc dịch vụ đã xong/huỷ → là dòng bỏ quên (đơn TEST, đơn đã DONE/CANCELLED, đơn bỏ dở).
--
-- LÀM GÌ (1 transaction, có bảng sao lưu để hoàn tác):
--   1. Sao lưu id + status + planned_end_time cũ vào "_bak_KtvAssignments_20261004".
--   2. Dòng còn sống của NGÀY LÀM VIỆC ĐÃ QUA, hoặc dịch vụ đã xong/huỷ/không còn:
--        dịch vụ DONE/CLEANING/FEEDBACK/COMPLETED → COMPLETED; còn lại → CANCELLED.
--      KHÔNG đụng Bookings / BookingItems / TurnQueue / sổ tiền — chỉ cột status của phiếu phân công.
--   3. Dòng còn sống có giờ kết thúc <= giờ bắt đầu (lỗi cũ qua nửa đêm: kết thúc lưu sang ngày hôm
--      trước) → cộng 1 ngày cho giờ kết thúc.
-- Ngày làm việc = giờ VN trừ mốc chuyển ngày (SystemConfigs.spa_day_cutoff_hours, mặc định 7h).
--
-- CÁCH CHẠY: SQL Editor project PRODUCTION → chạy [XEM TRƯỚC] (chỉ đọc) → chạy cả khối [DỌN].
-- HOÀN TÁC (nếu cần): xem khối [HOÀN TÁC] cuối file.
-- =====================================================================================

-- [XEM TRƯỚC] (chỉ đọc) — 04/10 ~05:00 dự kiến: đóng 321 (COMPLETED 237 / CANCELLED 84), sửa giờ 2
-- WITH biz AS (
--   SELECT ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
--           - make_interval(hours => COALESCE((SELECT NULLIF(btrim(value #>> '{}', '"'), '')::int FROM "SystemConfigs" WHERE key = 'spa_day_cutoff_hours'), 7)))::date AS today)
-- SELECT CASE WHEN ka.business_date < biz.today OR bi.id IS NULL OR bi.status IN ('DONE','CLEANING','FEEDBACK','COMPLETED','CANCELLED')
--             THEN CASE WHEN bi.status IN ('DONE','CLEANING','FEEDBACK','COMPLETED') THEN 'COMPLETED' ELSE 'CANCELLED' END
--             ELSE 'GIỮ' END AS ket_qua, count(*)
--   FROM "KtvAssignments" ka LEFT JOIN "BookingItems" bi ON bi.id = ka.booking_item_id, biz
--  WHERE ka.status IN ('ACTIVE','QUEUED','READY') GROUP BY 1 ORDER BY 1;

-- [DỌN]
BEGIN;

CREATE TABLE IF NOT EXISTS "_bak_KtvAssignments_20261004" AS
SELECT id, status, planned_end_time, now() AS backed_up_at FROM "KtvAssignments" WHERE false;

WITH biz AS (
  SELECT ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
          - make_interval(hours => COALESCE((SELECT NULLIF(btrim(value #>> '{}', '"'), '')::int FROM "SystemConfigs" WHERE key = 'spa_day_cutoff_hours'), 7)))::date AS today
), target AS (
  SELECT ka.id,
         CASE WHEN bi.status IN ('DONE','CLEANING','FEEDBACK','COMPLETED') THEN 'COMPLETED' ELSE 'CANCELLED' END AS new_status
    FROM "KtvAssignments" ka LEFT JOIN "BookingItems" bi ON bi.id = ka.booking_item_id, biz
   WHERE ka.status IN ('ACTIVE','QUEUED','READY')
     AND (ka.business_date < biz.today OR bi.id IS NULL
          OR bi.status IN ('DONE','CLEANING','FEEDBACK','COMPLETED','CANCELLED'))
), bak AS (
  INSERT INTO "_bak_KtvAssignments_20261004" (id, status, planned_end_time, backed_up_at)
  SELECT ka.id, ka.status, ka.planned_end_time, now() FROM "KtvAssignments" ka JOIN target t ON t.id = ka.id
  RETURNING id
)
UPDATE "KtvAssignments" ka
   SET status = t.new_status::"KtvAssignmentStatus", updated_at = now()
  FROM target t
 WHERE ka.id = t.id AND EXISTS (SELECT 1 FROM bak WHERE bak.id = t.id);

-- Giờ kết thúc lưu nhầm sang ngày hôm trước (đơn qua nửa đêm) → +1 ngày.
INSERT INTO "_bak_KtvAssignments_20261004" (id, status, planned_end_time, backed_up_at)
SELECT id, status, planned_end_time, now() FROM "KtvAssignments"
 WHERE status IN ('ACTIVE','QUEUED','READY') AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL
   AND planned_end_time <= planned_start_time AND planned_end_time + interval '1 day' > planned_start_time;
UPDATE "KtvAssignments"
   SET planned_end_time = planned_end_time + interval '1 day', updated_at = now()
 WHERE status IN ('ACTIVE','QUEUED','READY') AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL
   AND planned_end_time <= planned_start_time AND planned_end_time + interval '1 day' > planned_start_time;

-- Kiểm tra trong transaction: còn dòng sống thiếu/sai giờ → dừng, không ghi gì.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM "KtvAssignments"
   WHERE status IN ('ACTIVE','QUEUED','READY')
     AND (planned_start_time IS NULL OR planned_end_time IS NULL OR planned_end_time <= planned_start_time);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Còn % phân công sống thiếu/sai giờ sau khi dọn — gửi kết quả truy vấn [B] trong file migrate, dừng.', v_bad;
  END IF;
END $$;

COMMIT;

-- [SAU KHI DỌN] (chỉ đọc): số dòng đã đổi
-- SELECT count(*) FROM "_bak_KtvAssignments_20261004";

-- [HOÀN TÁC] (chỉ khi cần — trả status và giờ kết thúc về như trước khi dọn)
-- BEGIN;
-- UPDATE "KtvAssignments" ka SET status = b.status, planned_end_time = b.planned_end_time, updated_at = now()
--   FROM (SELECT DISTINCT ON (id) id, status, planned_end_time FROM "_bak_KtvAssignments_20261004" ORDER BY id, backed_up_at) b
--  WHERE ka.id = b.id;
-- COMMIT;
