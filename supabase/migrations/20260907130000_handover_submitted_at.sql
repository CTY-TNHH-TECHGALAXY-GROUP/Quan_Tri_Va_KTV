-- ================================================================
-- Mốc thời gian KTV NỘP ảnh bàn giao
-- ================================================================
-- VÌ SAO
--
-- Hai cron auto-duyệt (`/api/cron/auto-approve` và `/api/cron/ktv-auto-approve`)
-- đều lọc `.lte('updated_at', ...)`. Bảng "BookingItems" KHÔNG có cột đó — chỉ
-- có timeStart/timeEnd. Truy vấn lỗi, code không kiểm tra `error` nên coi như
-- "không có gì để duyệt" rồi đi tiếp. Tức là auto-duyệt CHƯA BAO GIỜ chạy được
-- cho bất kỳ đơn nào, không riêng vài đơn kẹt.
--
-- VÌ SAO KHÔNG THÊM `updated_at` NHƯ CODE ĐANG TƯỞNG
--
-- `updated_at` đổi mỗi khi dòng bị sửa bất kỳ thứ gì — đổi phòng, sửa ghi chú,
-- quầy chỉnh giờ — nên hạn duyệt bị dời oan mà không ai hiểu vì sao. Cái ta cần
-- là đúng một mốc: LÚC KTV NỘP ẢNH.
--
-- CÒN MỘT CÁI BẪY NỮA cột này chặn được:
--   `handover_status` có DEFAULT 'PENDING'. Tại thời điểm viết, 6067 dòng mang
--   PENDING nhưng chỉ 283 dòng thật sự có ảnh nộp — 5784 dòng còn lại chỉ là
--   giá trị mặc định của item chưa từng đi qua bàn giao. Nếu sửa cron theo
--   `handover_status = 'PENDING'` + một mốc thời gian chung thì nó sẽ duyệt sạch
--   gần 6000 đơn chưa ai nộp gì.
--   Cột này chỉ được ghi KHI THẬT SỰ NỘP ẢNH, nên dòng mặc định mãi NULL và
--   không bao giờ lọt vào hàng đợi duyệt.
--
-- LẤP DỮ LIỆU CŨ
--
-- Chỉ lấp cho những dòng có mốc nộp CÓ THẬT trong `segments[].handoverTime`.
-- Không suy đoán từ timeEnd cho các dòng còn lại: đoán sai thì cron duyệt hàng
-- loạt đơn cũ mà không ai kiểm. Phần đó để quyết riêng.
-- ================================================================

ALTER TABLE "BookingItems"
  ADD COLUMN IF NOT EXISTS "handover_submitted_at" timestamptz;

COMMENT ON COLUMN "BookingItems"."handover_submitted_at" IS
  'Lúc KTV nộp ảnh bàn giao. NULL = chưa nộp. Cron auto-duyệt đếm hạn từ mốc này, KHÔNG dùng handover_status vì cột đó mặc định là PENDING cho cả item chưa từng bàn giao.';

CREATE INDEX IF NOT EXISTS "idx_bookingitems_handover_submitted_at"
  ON "BookingItems" ("handover_submitted_at")
  WHERE "handover_submitted_at" IS NOT NULL;

-- Lấp từ mốc bàn giao có thật trong segments (lấy lần nộp muộn nhất của đơn).
UPDATE "BookingItems" bi
   SET "handover_submitted_at" = sub.ts
  FROM (
    SELECT b.id,
           MAX((seg->>'handoverTime')::timestamptz) AS ts
      FROM "BookingItems" b,
           LATERAL jsonb_array_elements(
             CASE jsonb_typeof(b."segments") WHEN 'array' THEN b."segments" ELSE '[]'::jsonb END
           ) AS seg
     WHERE seg ? 'handoverTime'
       AND seg->>'handoverTime' IS NOT NULL
     GROUP BY b.id
  ) sub
 WHERE bi.id = sub.id
   AND bi."handover_submitted_at" IS NULL;
