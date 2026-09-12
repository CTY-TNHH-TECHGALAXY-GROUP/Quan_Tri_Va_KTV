-- Migration to add configuration columns to Services table for automatic guest counting and KTV minimum requirements
ALTER TABLE "Services" 
ADD COLUMN IF NOT EXISTS "min_ktv_required" integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS "service_group" text DEFAULT 'MAIN';
