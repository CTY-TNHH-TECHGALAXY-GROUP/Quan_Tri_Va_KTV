-- ==============================================================================
-- 🕒 AUTO-SKIP RATING KHI QUÁ 24H (Supabase pg_cron)
-- ==============================================================================
-- 1. Tạo Function dọn dẹp đơn hàng
CREATE OR REPLACE FUNCTION auto_skip_rating_after_24h()
RETURNS void AS $$
DECLARE
    skipped_count int;
BEGIN
    -- 1. Cập nhật các Items thuộc về đơn sắp bị skip
    UPDATE "BookingItems"
    SET 
        status = 'DONE',
        "itemRating" = 0, -- 0 sao = Hệ thống tự bỏ qua
        "itemFeedback" = 'Auto-skipped after 24h'
    WHERE "bookingId" IN (
        SELECT id FROM "Bookings"
        WHERE status IN ('COMPLETED', 'FEEDBACK')
        AND COALESCE("timeEnd", "updatedAt", "createdAt") < NOW() - INTERVAL '24 hours'
    ) AND status != 'DONE';

    -- 2. Cập nhật bảng Bookings chính
    WITH updated AS (
        UPDATE "Bookings"
        SET 
            status = 'DONE',
            rating = 0,
            "feedbackNote" = 'Auto-skipped after 24h',
            "updatedAt" = NOW()
        WHERE status IN ('COMPLETED', 'FEEDBACK')
        AND COALESCE("timeEnd", "updatedAt", "createdAt") < NOW() - INTERVAL '24 hours'
        RETURNING id
    )
    SELECT count(*) INTO skipped_count FROM updated;

    RAISE LOG 'Auto-skipped rating for % bookings.', skipped_count;
END;
$$ LANGUAGE plpgsql;

-- 2. Đăng ký chạy ngầm mỗi giờ 1 lần bằng pg_cron
-- (Sẽ chạy vào phút thứ 0 của mỗi giờ: 1:00, 2:00, 3:00...)
SELECT cron.schedule(
    'auto_skip_rating_job', -- Tên job
    '0 * * * *',           -- Chạy mỗi giờ
    $$ SELECT auto_skip_rating_after_24h(); $$
);

-- ==============================================================================
-- DÀNH CHO ADMIN: Các lệnh hữu ích để quản lý Job
-- ==============================================================================
-- Xem danh sách các job đang chạy:
-- SELECT * FROM cron.job;
--
-- Xóa job nếu cần:
-- SELECT cron.unschedule('auto_skip_rating_job');
