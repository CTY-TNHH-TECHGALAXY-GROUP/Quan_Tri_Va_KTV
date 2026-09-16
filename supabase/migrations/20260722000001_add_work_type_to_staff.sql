-- Cập nhật bảng Staff, thêm cột work_type
ALTER TABLE "Staff" ADD COLUMN work_type TEXT DEFAULT 'TYPE_A';
ALTER TABLE "Staff" ADD CONSTRAINT check_work_type CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C'));

-- Đặt giá trị mặc định cho những record hiện có
UPDATE "Staff" SET work_type = 'TYPE_A' WHERE work_type IS NULL;
