-- Tác giả: Antigravity
-- Ngày: 2026-07-28
-- Mục đích: Bổ sung room_id vào EmployeeRoutines để gán đích danh việc phòng cho nhân viên.

-- 1. Thêm cột room_id
ALTER TABLE "EmployeeRoutines" 
ADD COLUMN IF NOT EXISTS room_id text REFERENCES "Rooms"(id) ON DELETE CASCADE;

-- 2. Xóa các unique constraint cũ (nếu có)
DO $$
DECLARE
    row record;
BEGIN
    FOR row IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '"EmployeeRoutines"'::regclass AND contype = 'u'
    LOOP
        EXECUTE 'ALTER TABLE "EmployeeRoutines" DROP CONSTRAINT IF EXISTS "' || row.conname || '"';
    END LOOP;
END
$$;

-- 3. Xóa index cũ (nếu có)
DROP INDEX IF EXISTS unique_emp_routine;

-- 4. Tạo Unique Index mới cho phép COALESCE(room_id, '')
CREATE UNIQUE INDEX unique_emp_routine ON "EmployeeRoutines" (employee_id, template_id, COALESCE(room_id, ''));
