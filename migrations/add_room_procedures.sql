-- Migration: Add room-specific procedures to Rooms table
-- Run this in Supabase SQL Editor

ALTER TABLE "Rooms"
ADD COLUMN IF NOT EXISTS "prep_procedure" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "clean_procedure" jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "Rooms"."prep_procedure" IS 'Danh sach quy trinh mo phong (JSON array of strings)';
COMMENT ON COLUMN "Rooms"."clean_procedure" IS 'Danh sach quy trinh don dep phong (JSON array of strings)';
