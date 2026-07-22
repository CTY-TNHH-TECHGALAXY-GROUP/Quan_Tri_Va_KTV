-- ==========================================
-- MIGRATION: Thêm quyền leave_management cho Admin và Reception
-- Chạy trên Supabase SQL Editor
-- ==========================================

-- Thêm 'leave_management' vào mảng permissions của role admin
UPDATE public."Roles"
SET permissions = array_append(permissions, 'leave_management')
WHERE id = 'admin' AND NOT ('leave_management' = ANY(permissions));

-- Thêm cho reception
UPDATE public."Roles"
SET permissions = array_append(permissions, 'leave_management')
WHERE id = 'reception' AND NOT ('leave_management' = ANY(permissions));
