-- Thêm cột total_tax vào KTVDailyLedger
ALTER TABLE "public"."KTVDailyLedger"
ADD COLUMN "total_tax" numeric(15,2) DEFAULT 0;

-- Cập nhật mô tả (comment)
COMMENT ON COLUMN "public"."KTVDailyLedger"."total_tax" IS 'Chỉ lưu vết đối chiếu thuế Loại D, không trừ trực tiếp vào Ví ở đây';
