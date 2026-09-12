ALTER TABLE "public"."TaskTemplates" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
ALTER TABLE "public"."Tasks" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
