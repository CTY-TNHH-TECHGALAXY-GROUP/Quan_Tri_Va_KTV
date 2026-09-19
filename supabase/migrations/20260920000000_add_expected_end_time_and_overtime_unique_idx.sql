ALTER TABLE public."KTVTypeDDailyRegistration"
  ADD COLUMN IF NOT EXISTS "expected_end_time" TIME;

COMMENT ON COLUMN public."KTVTypeDDailyRegistration"."expected_end_time"
  IS 'Giờ tan làm KTV D tự đăng ký cho work_date; nguồn giờ gốc khi gia hạn.';

-- Cleanup có guard chặt: chỉ reject record 19:30 khi đúng toàn bộ dữ liệu
-- lịch sử và record thay thế 22:30 thực sự tồn tại. Môi trường không có cặp
-- lịch sử này phải no-op.
UPDATE public."KTVAttendance" old_record
SET "status" = 'REJECTED',
    "reason" = 'Đã được thay thế bởi lần gia hạn 22:30; cleanup trước unique index'
WHERE old_record."id" = '760626a8-1b3c-4f8d-8a01-0b188f7abd0e'
  AND old_record."employeeId" = 'NH016'
  AND old_record."date" = '2026-07-07'
  AND old_record."checkType" = 'OVERTIME'
  AND old_record."status" = 'CONFIRMED'
  AND old_record."estimatedEndTime" = '19:30'
  AND EXISTS (
    SELECT 1
    FROM public."KTVAttendance" replacement
    WHERE replacement."id" = '0c45c3e3-f8b0-41a8-83f2-08e1f4920bec'
      AND replacement."employeeId" = old_record."employeeId"
      AND replacement."date" = old_record."date"
      AND replacement."checkType" = 'OVERTIME'
      AND replacement."status" = 'CONFIRMED'
      AND replacement."estimatedEndTime" = '22:30'
  );

CREATE UNIQUE INDEX IF NOT EXISTS
  "KTVAttendance_one_overtime_per_workday"
ON public."KTVAttendance" ("employeeId", "date")
WHERE "checkType" = 'OVERTIME'
  AND "status" <> 'REJECTED';
