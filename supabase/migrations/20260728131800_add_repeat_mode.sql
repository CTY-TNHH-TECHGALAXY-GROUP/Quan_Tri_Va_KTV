-- Migration to add repeat_mode to TaskCategories
ALTER TABLE "public"."TaskCategories" ADD COLUMN IF NOT EXISTS "repeat_mode" text DEFAULT 'DAILY';