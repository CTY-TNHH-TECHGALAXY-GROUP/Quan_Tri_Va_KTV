-- 1. Alter category column to jsonb
ALTER TABLE "Services" ALTER COLUMN category TYPE jsonb USING jsonb_build_array(category);
