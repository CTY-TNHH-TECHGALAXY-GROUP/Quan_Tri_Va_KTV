-- Migration: Add allowed_services column to Rooms table
-- Run this in Supabase SQL Editor

ALTER TABLE "Rooms"
ADD COLUMN IF NOT EXISTS "allowed_services" jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "Rooms"."allowed_services" IS 'Danh sach ID dich vu phong nay co the nhan (JSON array of service IDs)';
