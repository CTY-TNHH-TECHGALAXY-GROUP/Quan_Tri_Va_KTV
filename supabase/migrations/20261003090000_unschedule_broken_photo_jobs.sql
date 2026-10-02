-- Gỡ 2 job pg_cron xoá ảnh chấm công đang lỗi MỖI NGÀY từ tháng 4/2026:
--   ERROR: Direct deletion from storage tables is not allowed. Use the Storage API instead.
-- Supabase chặn DELETE thẳng trên storage.objects, nên hai job này chưa từng xoá được file nào.
-- Chúng còn xoá KHÔNG phân loại: bucket `attendance` chứa cả ảnh bàn giao và bằng chứng
-- kỷ luật (`office-evidence/`), không chỉ ảnh chấm công.
--
-- Thay bằng Vercel Cron `/api/cron/cleanup-photos` (lib/services/PhotoCleanupService.ts),
-- xoá qua Storage API. Plan: plans/plan_cron_xoa_anh_cham_cong_30_ngay.md

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_delete_old_attendance_photos') THEN
    PERFORM cron.unschedule('auto_delete_old_attendance_photos');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delete-old-attendance-photos') THEN
    PERFORM cron.unschedule('delete-old-attendance-photos');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.delete_old_attendance_photos();
