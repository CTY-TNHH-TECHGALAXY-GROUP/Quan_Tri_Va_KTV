ALTER TABLE "public"."Bookings" ADD COLUMN IF NOT EXISTS "vatRequested" BOOLEAN DEFAULT false;
