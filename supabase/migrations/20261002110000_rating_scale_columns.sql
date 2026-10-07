-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ1, 02/10/2026)
-- Mỗi đánh giá lưu kèm thang lúc chấm (4 hoặc 5 sao). Mặc định 4 = toàn bộ đánh giá cũ,
-- nên đổi thang trong Cài đặt không làm đổi tiền / thưởng / báo cáo của đánh giá đã có.
-- ADD COLUMN ... DEFAULT hằng số chỉ ghi metadata (không viết lại bảng).
ALTER TABLE "Bookings"      ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
ALTER TABLE "BookingItems"  ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
ALTER TABLE "BookingGuests" ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;

DO $$ BEGIN
  ALTER TABLE "Bookings"      ADD CONSTRAINT bookings_rating_scale_check      CHECK (rating_scale IN (4,5));
  ALTER TABLE "BookingItems"  ADD CONSTRAINT bookingitems_rating_scale_check  CHECK (rating_scale IN (4,5));
  ALTER TABLE "BookingGuests" ADD CONSTRAINT bookingguests_rating_scale_check CHECK (rating_scale IN (4,5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN "Bookings".rating_scale      IS 'Thang sao lúc chấm rating (4|5). Diễn giải rating theo cột này.';
COMMENT ON COLUMN "BookingItems".rating_scale  IS 'Thang sao lúc chấm itemRating/ktvRatings (4|5).';
COMMENT ON COLUMN "BookingGuests".rating_scale IS 'Thang sao lúc chấm rating/ktv_ratings của khách (4|5).';
