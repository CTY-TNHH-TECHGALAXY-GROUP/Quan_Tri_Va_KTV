-- Migration: Add segments column to BookingItems for multi-stage tracking
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "segments" JSONB DEFAULT '[]'::jsonb;
