-- Chuẩn hoá BookingItems.segments: luôn lưu MẢNG jsonb, không lưu chuỗi JSON (07/10/2026).
-- Plan: plans/plan_chuan_hoa_segments_trigger.md
--
-- Vì sao: 8 chỗ code ghi JSON.stringify(...) → cột jsonb nhận một CHUỖI bọc mảng (57% dữ liệu prod).
-- ~40 hàm DB phải tự gỡ bằng jsonb_unwrap_string (vá ở 36 migration) và vẫn sót: dispatch_commit_form
-- nhánh dịch vụ chưa bắt đầu báo `cannot extract elements from a scalar` → không gán KTV cho dịch vụ phát sinh.
--
-- Cách: trigger BEFORE INSERT/UPDATE OF segments đổi chuỗi → mảng NGAY TẠI CHỖ GHI, cho mọi app.
--   - Chỉ đổi kiểu lưu, KHÔNG đổi nội dung (giờ, phút, KTV, phòng giữ nguyên).
--   - Chuỗi hỏng / lỗi bất kỳ → giữ nguyên NEW, KHÔNG BAO GIỜ chặn lần ghi.
--   - Không phát sinh lần ghi mới → các trigger AFTER (trg_ktvd_enqueue_item…) chạy đúng như hôm nay.
--   - Tên `aa_` để chạy TRƯỚC guard_sequential_item_update_trigger / zz_dispatch_edit_history (BEFORE chạy theo tên).
-- Dữ liệu cũ đổi bằng script riêng (scripts/qa/seg_backfill.js, transaction replica — không kích trigger).
-- Lùi: DROP TRIGGER aa_normalize_segments ON "BookingItems";

CREATE OR REPLACE FUNCTION normalize_booking_item_segments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.segments IS NOT NULL AND jsonb_typeof(NEW.segments) = 'string' THEN
        BEGIN
            NEW.segments := COALESCE(jsonb_unwrap_string(NEW.segments), NEW.segments);
        EXCEPTION WHEN OTHERS THEN
            NULL; -- giữ nguyên, không chặn ghi
        END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_normalize_segments ON "BookingItems";
CREATE TRIGGER aa_normalize_segments
    BEFORE INSERT OR UPDATE OF segments ON "BookingItems"
    FOR EACH ROW EXECUTE FUNCTION normalize_booking_item_segments();
