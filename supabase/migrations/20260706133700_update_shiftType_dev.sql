-- ==========================================
-- MIGRATION: UPDATE KTVShifts CHECK CONSTRAINT
-- Thêm DEV_SHIFT và SUPPORT
-- ==========================================

-- 1. Xóa constraint cũ
ALTER TABLE public."KTVShifts" DROP CONSTRAINT IF EXISTS "KTVShifts_shiftType_check";

-- 2. Thêm constraint mới hỗ trợ đầy đủ các ca
ALTER TABLE public."KTVShifts" ADD CONSTRAINT "KTVShifts_shiftType_check" 
CHECK ("shiftType" IN ('SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST', 'DEV_SHIFT', 'SUPPORT'));
