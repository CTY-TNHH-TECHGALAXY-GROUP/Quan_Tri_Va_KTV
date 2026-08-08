-- ===========================================
-- Tạo tài khoản DEV (có tất cả quyền)
-- ===========================================

-- Bước 1: Thêm 'DEV' vào enum Role (nếu chưa có)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DEV';

-- Bước 2: Tạo user dev
INSERT INTO "Users" (id, username, password, "fullName", role, permissions)
VALUES (
  gen_random_uuid()::text,  -- ID tự sinh
  'dev',                    -- Username đăng nhập
  '1470',                   -- Mật khẩu
  'Developer',              -- Tên hiển thị
  'DEV',                    -- Role
  '["dashboard","dispatch_board","order_management","customer_management","revenue_reports","payroll_commissions","cashbook_supplies","web_booking","service_menu","role_management","employee_management","ktv_dashboard","ktv_attendance","ktv_leave","ktv_performance","ktv_history","turn_tracking","ktv_hub","service_handbook","ai_features","device_management","staff_notifications","settings"]'::jsonb
);
