-- ================================================================
-- Chống tích "Yêu cầu rút tiền" nhiều lần trong một ngày
-- Kế hoạch: plans/plan_ktvd_turn_ledger.md (bước 7)
-- ================================================================
-- Ô tích "Yêu cầu rút tiền" nằm trên form ĐIỂM DANH. Mỗi lần KTV điểm danh
-- có tích là hệ thống chèn một dòng KTVWithdrawals `amount = 1` — chỉ là tín
-- hiệu báo Thu ngân chuẩn bị tiền mặt, không phải số tiền thật.
--
-- Nhưng KHÔNG có chốt chặn nào: tan ca rồi đăng nhập lại, điểm danh lần nữa
-- và tích lại là ra dòng thứ hai. Mỗi dòng thừa còn bị cộng vào `total_pending`
-- nên trừ oan 1đ vào số dư, và làm rác hàng đợi duyệt của Thu ngân.
--
-- Khoá theo NGÀY LÀM VIỆC, không phải ngày lịch — để ca đêm qua nửa đêm vẫn
-- tính là một ngày.

ALTER TABLE "KTVWithdrawals"
  ADD COLUMN IF NOT EXISTS "intent_date" DATE;

COMMENT ON COLUMN "KTVWithdrawals"."intent_date" IS
  'Ngày làm việc của dòng "báo trước lúc điểm danh" (amount = 1). NULL với lệnh rút tiền thật. Dùng để mỗi KTV chỉ báo được 1 lần/ngày.';

-- Partial index: chỉ ràng buộc các dòng tín hiệu, không đụng lệnh rút thật.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_withdrawal_intent_per_day"
  ON "KTVWithdrawals" ("staff_id", "intent_date")
  WHERE "intent_date" IS NOT NULL;

-- Backfill: CHỈ đánh dấu dòng SỚM NHẤT của mỗi (KTV, ngày).
-- Dữ liệu hiện tại đã có trùng lặp thật — T016 tích 3 lần ngày 02/09, NH011
-- tích 2 lần ở hai ngày khác nhau. Đánh dấu tất cả sẽ vi phạm unique index.
-- Các dòng trùng còn lại vẫn bị loại khỏi số dư ví nhờ lọc theo mẫu
-- (amount = 1 + note 'Báo trước') ở tầng ứng dụng, nên không cần xoá.
WITH som_nhat AS (
    SELECT DISTINCT ON ("staff_id", ("request_date" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
           "id",
           ("request_date" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ngay
    FROM "KTVWithdrawals"
    WHERE "intent_date" IS NULL
      AND ABS("amount") = 1
      AND "note" ILIKE '%Báo trước%'
      AND "request_date" >= '2026-09-01'
    ORDER BY "staff_id",
             ("request_date" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
             "request_date" ASC
)
UPDATE "KTVWithdrawals" w
SET "intent_date" = s.ngay
FROM som_nhat s
WHERE w."id" = s."id";
