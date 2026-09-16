-- Migration: Enhance BookingItems and TurnQueue for Multi-tech/Multi-room support
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "roomName" TEXT;
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "bedId" TEXT;
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "technicianCodes" TEXT[] DEFAULT '{}';
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'WAITING';
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "timeStart" TIMESTAMP WITH TIME ZONE;
ALTER TABLE public."BookingItems" ADD COLUMN IF NOT EXISTS "timeEnd" TIMESTAMP WITH TIME ZONE;

ALTER TABLE public."TurnQueue" ADD COLUMN IF NOT EXISTS "booking_item_id" UUID;
