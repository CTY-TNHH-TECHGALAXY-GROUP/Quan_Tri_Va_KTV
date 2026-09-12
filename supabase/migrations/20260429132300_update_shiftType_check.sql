-- ==========================================
-- MIGRATION: UPDATE KTVShifts CHECK CONSTRAINT
-- Thêm ca tự do và ca khách yêu cầu
-- ==========================================

-- 1. Xóa constraint cũ
ALTER TABLE public."KTVShifts" DROP CONSTRAINT IF EXISTS "KTVShifts_shiftType_check";

-- 2. Thêm constraint mới hỗ trợ FREE và REQUEST
ALTER TABLE public."KTVShifts" ADD CONSTRAINT "KTVShifts_shiftType_check" 
CHECK ("shiftType" IN ('SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'));
