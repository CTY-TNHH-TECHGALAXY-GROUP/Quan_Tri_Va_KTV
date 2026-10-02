-- ================================================================
-- Đánh dấu tua có làm chung KTV KHÁC LOẠI
-- ================================================================
-- Quy chế: KTV loại D làm chung với KTV loại khác thì KHÔNG có thưởng, dù
-- khách chấm 4★. Nhưng tiền tua vẫn bị trừ bình thường nếu bị chấm thấp.
--
-- Lưu vào dòng sổ để màn hình lịch sử giải thích được cho KTV vì sao tua đó
-- không có thưởng — tránh thắc mắc "tôi được 4 sao sao không có thưởng".

ALTER TABLE "KTVDTurnLedger"
  ADD COLUMN IF NOT EXISTS "has_other_type_coworker" BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN "KTVDTurnLedger"."has_other_type_coworker" IS
  'Tua này có KTV không thuộc loại D làm cùng (cùng một KHÁCH). Khi true thì không phát thưởng, nhưng tiền tua vẫn tính và vẫn trừ theo sao.';
