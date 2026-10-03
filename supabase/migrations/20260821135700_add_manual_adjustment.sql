ALTER TABLE "public"."TurnQueue" ADD COLUMN IF NOT EXISTS "manual_adjustment" integer DEFAULT 0;
