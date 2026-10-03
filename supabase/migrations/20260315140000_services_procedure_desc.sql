-- Migration: Add procedure and service_description to Services table
ALTER TABLE public."Services" ADD COLUMN IF NOT EXISTS "procedure" TEXT;
ALTER TABLE public."Services" ADD COLUMN IF NOT EXISTS "service_description" TEXT;
