-- ================================================================
-- Bàn giao đã nộp thì không được còn cờ "bỏ qua"
-- ================================================================
-- VÌ SAO
--
-- Đợt Handover V5 (26/07, d9b087c) thêm cột `handover_skipped` và một đường
-- nộp mới (`HandoverService.submitHandover`) hạ cờ đó đúng cách. Nhưng màn KTV
-- chưa bao giờ được chuyển sang đường mới — nó vẫn gọi RELEASE_KTV, đường có
-- từ 23/07 (3b56e27), tức là có TRƯỚC khi cột này ra đời. Đường cũ chỉ biết ghi
-- `handover_status`, không biết cột mới tồn tại.
--
-- Hậu quả: KTV nộp đủ ảnh qua màn hình thật thì bản ghi thành
--     handover_status = 'PENDING'  +  handover_skipped = true
-- một trạng thái mà V5 coi là bất khả thi. Cron `autoApproveExpired` lọc
-- `.eq('handover_skipped', false)` nên không bao giờ nhìn thấy → treo PENDING
-- vĩnh viễn, quầy không thấy để duyệt, KTV thì tưởng đã xong.
--
-- Lỗi này âm thầm suốt hơn một tháng vì cron lọc chứ không báo lỗi: dòng chỉ
-- biến mất khỏi hàng đợi. Tại thời điểm viết migration có 2 bản ghi mắc kẹt,
-- một cái từ 14/08 với 14 ảnh đã nộp.
--
-- LÀM GÌ Ở ĐÂY
--   1. Dọn các bản ghi đang kẹt (đã nộp ảnh mà cờ chưa hạ).
--   2. Dựng CHECK constraint để quy ước này do DATABASE giữ, không phụ thuộc
--      việc lập trình viên có nhớ hay không. Có nó từ đầu thì lần refactor
--      03/08 (6fa2cdb) đã fail ngay lúc chạy thay vì hỏng lặng lẽ.
--
-- Mã nguồn đã sửa kèm: app/api/ktv/booking/_handlers/handleReleaseKTV.ts
-- ================================================================

-- ─── 1. DỌN CÁC BẢN GHI ĐANG KẸT ───
-- Chỉ đụng đúng những dòng vướng quy ước. APPROVED cũng gom vào cho sạch:
-- đã duyệt xong thì lại càng không thể còn là "bỏ qua".
UPDATE "BookingItems"
   SET "handover_skipped" = false
 WHERE "handover_skipped" = true
   AND "handover_status" IN ('PENDING', 'APPROVED');

-- ─── 2. RÀO CHẶN ───
-- Bỏ trước rồi thêm lại để chạy lại migration nhiều lần vẫn được.
ALTER TABLE "BookingItems"
  DROP CONSTRAINT IF EXISTS "bookingitems_handover_skipped_invariant";

ALTER TABLE "BookingItems"
  ADD CONSTRAINT "bookingitems_handover_skipped_invariant"
  CHECK (
    NOT ("handover_skipped" = true AND "handover_status" IN ('PENDING', 'APPROVED'))
  );

COMMENT ON CONSTRAINT "bookingitems_handover_skipped_invariant" ON "BookingItems" IS
  'Đã nộp (PENDING) hoặc đã duyệt (APPROVED) thì handover_skipped bắt buộc false. Cron autoApproveExpired lọc theo cờ này; để lệch là đơn treo vĩnh viễn.';
