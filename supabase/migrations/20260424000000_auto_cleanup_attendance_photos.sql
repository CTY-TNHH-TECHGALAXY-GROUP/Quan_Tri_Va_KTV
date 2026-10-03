-- =====================================================================================
-- Migration: Auto Cleanup Attendance Photos
-- Description: Tạo cron job tự động xoá ảnh điểm danh KTV cũ hơn 7 ngày trong Supabase Storage
-- =====================================================================================

-- Bật extension pg_cron nếu chưa có
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Xoá function cũ nếu có để tránh lỗi khi migrate lại
DROP FUNCTION IF EXISTS delete_old_attendance_photos();

-- Tạo function xoá các object cũ hơn 7 ngày trong bucket 'attendance'
CREATE OR REPLACE FUNCTION delete_old_attendance_photos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Khi xoá record trong storage.objects, Supabase Storage API sẽ tự động 
    -- trigger để xoá file thật dưới S3.
    DELETE FROM storage.objects
    WHERE bucket_id = 'attendance'
      AND created_at < now() - interval '7 days';
END;
$$;

-- Huỷ cron job cũ nếu có để tránh trùng lặp
DO $$
BEGIN
  PERFORM cron.unschedule('delete-old-attendance-photos');
EXCEPTION WHEN OTHERS THEN
  -- Bỏ qua lỗi nếu job chưa tồn tại
END;
$$;

-- Lập lịch chạy cron job mỗi ngày vào lúc 03:00 sáng
SELECT cron.schedule(
    'delete-old-attendance-photos', -- Tên job
    '0 3 * * *',                    -- Chạy lúc 03:00 mỗi ngày
    'SELECT delete_old_attendance_photos();'
);
