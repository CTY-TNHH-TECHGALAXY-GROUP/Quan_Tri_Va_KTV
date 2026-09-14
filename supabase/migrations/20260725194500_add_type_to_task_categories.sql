-- Thêm cột type vào TaskCategories để phân biệt Mẫu việc Nhân Sự (ROLE) và Mẫu việc Phòng (ROOM)
ALTER TABLE "public"."TaskCategories" 
ADD COLUMN "type" text NOT NULL DEFAULT 'ROLE';

-- Ràng buộc (Constraint) để đảm bảo giá trị chỉ có thể là ROLE hoặc ROOM
ALTER TABLE "public"."TaskCategories" 
ADD CONSTRAINT "TaskCategories_type_check" CHECK ("type" IN ('ROLE', 'ROOM'));
