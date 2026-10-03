-- ─────────────────────────────────────────────────────────────
-- Setup pg_cron + pg_net để chạy daily-absence-check độc lập với Vercel cron.
-- Cho phép test trên preview deployment (nơi Vercel cron không chạy).
--
-- YÊU CẦU: Supabase project có bật extension pg_cron + pg_net
-- (available từ Free tier trở lên, không cần Pro).
--
-- TRƯỚC KHI CHẠY MIGRATION NÀY, phải set 2 secret trong Vault
-- (Dashboard → Project Settings → Vault):
--   app_url         → https://<domain-production-hoac-preview>
--   cron_secret     → giá trị CRON_SECRET (khớp với biến env của Vercel)
--
-- Nếu chưa dùng Vault, có thể hard-code URL/secret trong CREATE FUNCTION
-- bên dưới (không khuyến khích — commit vào git là lộ).
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Xóa job cũ nếu đã có (để migration idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('ktvd-daily-absence-check');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('ktvd-lock-unregistered');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Hàm helper: đọc secret từ Vault
CREATE OR REPLACE FUNCTION public.get_vault_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;
  RETURN secret_value;
END;
$$;

-- Hàm gọi API endpoint (helper để tránh lặp code)
CREATE OR REPLACE FUNCTION public.call_absence_check(mode text DEFAULT '')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  app_url text;
  cron_secret text;
  full_url text;
  request_id bigint;
BEGIN
  app_url := public.get_vault_secret('app_url');
  cron_secret := public.get_vault_secret('cron_secret');

  IF app_url IS NULL OR cron_secret IS NULL THEN
    RAISE EXCEPTION 'Missing vault secret: app_url or cron_secret';
  END IF;

  full_url := app_url || '/api/cron/daily-absence-check';
  IF mode <> '' THEN
    full_url := full_url || '?mode=' || mode;
  END IF;

  SELECT net.http_post(
    url := full_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

-- Cron 1: Chốt sổ cuối ngày làm việc — 06:30 sáng VN (= 23:30 UTC)
SELECT cron.schedule(
  'ktvd-daily-absence-check',
  '30 23 * * *',
  $$SELECT public.call_absence_check();$$
);

-- Cron 2: Khóa những ai chưa đăng ký lịch hôm sau — 00:00 VN (= 17:00 UTC)
SELECT cron.schedule(
  'ktvd-lock-unregistered',
  '0 17 * * *',
  $$SELECT public.call_absence_check('lock-unregistered');$$
);

-- Cấp quyền để nhóm dashboard có thể xem job/history
GRANT USAGE ON SCHEMA cron TO postgres, service_role;
GRANT SELECT ON cron.job TO postgres, service_role;
GRANT SELECT ON cron.job_run_details TO postgres, service_role;

-- ─────────────────────────────────────────────────────────────
-- KIỂM TRA
-- ─────────────────────────────────────────────────────────────
-- Xem 2 job đã đăng ký:
--   SELECT jobname, schedule, command, active FROM cron.job;
--
-- Xem 20 lần chạy gần nhất:
--   SELECT jobid, runid, status, return_message, start_time, end_time
--   FROM cron.job_run_details
--   ORDER BY start_time DESC
--   LIMIT 20;
--
-- Trigger thủ công 1 lần để test:
--   SELECT public.call_absence_check();
--
-- Xem response HTTP:
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
--
-- Xóa cron nếu muốn dừng:
--   SELECT cron.unschedule('ktvd-daily-absence-check');
--   SELECT cron.unschedule('ktvd-lock-unregistered');
-- ─────────────────────────────────────────────────────────────
