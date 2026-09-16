-- ==========================================
-- MIGRATION: ĐIỂM DANH, OFF CÓ GHI CHÚ VÀ HÌNH ẢNH
-- Tạo cột reason và Bucket 'attendance', kèm script tự xóa sau 30 ngày
-- ==========================================

-- 1. THÊM CỘT 'REASON' VÀO KTVAttendance
ALTER TABLE public."KTVAttendance" ADD COLUMN IF NOT EXISTS "reason" TEXT;

-- Cập nhật checkType constraint (nếu có enum thì update, tạm thời text thì không sao)
-- KTVAttendance.checkType hiện tại là TEXT, hỗ trợ: CHECK_IN, CHECK_OUT, LATE_CHECKIN, OFF_REQUEST

-- 2. KHỞI TẠO BUCKET 'attendance'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'attendance', 
  'attendance', 
  true, 
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

-- RLS Policies cho storage.objects
-- Chỉ cho phép user đã đăng nhập upload ảnh
CREATE POLICY "Cho phép KTV upload ảnh điểm danh"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'attendance');

-- Public có thể xem ảnh
CREATE POLICY "Mọi người đều xem được ảnh điểm danh"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'attendance');

-- 3. TẠO CRON JOB XÓA TỰ ĐỘNG SAU 30 NGÀY (CẦN PG_CRON)
-- Hướng dẫn: Bạn cần bật extension `pg_cron` trong Database Extensions.
-- Tự động chạy xoá ảnh lưu từ 30 ngày trước vào 2:00 AM mỗi ngày.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Xoá dữ liệu từ thư mục Storage
    PERFORM cron.schedule(
      'auto_delete_old_attendance_photos',
      '0 2 * * *', -- Chạy vào lúc 2:00 AM mỗi ngày
      $cmd$ DELETE FROM storage.objects WHERE bucket_id = 'attendance' AND created_at < NOW() - INTERVAL '30 days'; $cmd$
    );
    -- (Tùy chọn) Xoá metadata tương ứng hoặc để nguyên bản ghi text trong bảng KTVAttendance
  END IF;
END $$;
