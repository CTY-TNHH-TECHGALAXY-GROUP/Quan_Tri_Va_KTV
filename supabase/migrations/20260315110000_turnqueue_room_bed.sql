-- Migration: Add room and bed tracking to TurnQueue for per-tech assignments
ALTER TABLE public."TurnQueue" ADD COLUMN IF NOT EXISTS "room_id" TEXT;
ALTER TABLE public."TurnQueue" ADD COLUMN IF NOT EXISTS "bed_id" TEXT;
