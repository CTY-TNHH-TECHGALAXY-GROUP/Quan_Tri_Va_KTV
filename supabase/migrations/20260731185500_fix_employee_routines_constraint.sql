-- Bỏ constraint cũ (chỉ kiểm tra employee_id và template_id)
ALTER TABLE "EmployeeRoutines" DROP CONSTRAINT IF EXISTS "EmployeeRoutines_employee_id_template_id_key";

-- Thêm constraint mới (kiểm tra thêm cả room_id, cho phép 1 KTV có cùng 1 công việc nhưng ở 2 phòng khác nhau)
-- Dùng NULLS NOT DISTINCT để postgres coi các giá trị NULL của room_id là giống nhau (tránh trùng lặp công việc chung)
ALTER TABLE "EmployeeRoutines" ADD CONSTRAINT "EmployeeRoutines_emp_tpl_room_key" UNIQUE NULLS NOT DISTINCT (employee_id, template_id, room_id);
