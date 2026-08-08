-- 1. Tạo bảng trung gian RoomTaskTemplates
CREATE TABLE "public"."RoomTaskTemplates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "room_id" text NOT NULL,
    "template_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "RoomTaskTemplates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoomTaskTemplates_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."Rooms"("id") ON DELETE CASCADE,
    CONSTRAINT "RoomTaskTemplates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."TaskTemplates"("id") ON DELETE CASCADE
);

-- 2. Thêm Unique Constraint để tránh gán trùng 1 việc cho 1 phòng nhiều lần
ALTER TABLE "public"."RoomTaskTemplates" 
ADD CONSTRAINT "RoomTaskTemplates_room_template_unique" UNIQUE ("room_id", "template_id");

-- 3. Bật RLS (Row Level Security) và cấp quyền truy cập (nếu đang dùng)
ALTER TABLE "public"."RoomTaskTemplates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated users" 
ON "public"."RoomTaskTemplates" 
FOR ALL 
TO authenticated 
USING (true);

-- 4. Xoá cột room_id cũ khỏi TaskTemplates (sau khi đã backup dữ liệu nếu cần)
ALTER TABLE "public"."TaskTemplates" DROP COLUMN IF EXISTS "room_id";
