-- Add custom_min_photo_count to RoomTaskTemplates
ALTER TABLE "public"."RoomTaskTemplates" ADD COLUMN IF NOT EXISTS "custom_min_photo_count" integer;

-- Add min_photo_count to Tasks
ALTER TABLE "public"."Tasks" ADD COLUMN IF NOT EXISTS "min_photo_count" integer;
