-- Migration: Standardize admin permissions to array format & add admin unlock password

-- 1. Update admin permissions from legacy object format to module array format
UPDATE "Users" 
SET permissions = '["dashboard","dispatch_board","order_management","customer_management","revenue_reports","payroll_commissions","cashbook_supplies","web_booking","service_menu","role_management","employee_management","ktv_hub","leave_management","ktv_dashboard","ktv_attendance","ktv_schedule","ktv_performance","ktv_history","turn_tracking","service_handbook","ai_features","staff_notifications","device_management","room_management","settings"]'::jsonb
WHERE role = 'ADMIN';

-- 2. Add system admin unlock password to SystemConfigs (if not exists)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('admin_unlock_password', '"nganhaspa2026"', 'Mật khẩu mở khoá chỉnh sửa quyền Admin trong trang Phân Quyền')
ON CONFLICT (key) DO NOTHING;
