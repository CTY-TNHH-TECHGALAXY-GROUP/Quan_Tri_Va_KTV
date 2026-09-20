-- Migration: Ensure Staff.gallery_urls is jsonb with empty array default and reload PostgREST schema cache
DO $$
BEGIN
  -- 1. If column exists and is ARRAY (text[]), drop default if any, then convert to jsonb preserving data
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Staff'
      AND column_name = 'gallery_urls'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE public."Staff"
      ALTER COLUMN gallery_urls DROP DEFAULT;

    ALTER TABLE public."Staff"
      ALTER COLUMN gallery_urls TYPE jsonb
      USING to_jsonb(gallery_urls);
  -- 2. If column does not exist at all, add it as jsonb
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Staff'
      AND column_name = 'gallery_urls'
  ) THEN
    ALTER TABLE public."Staff"
      ADD COLUMN gallery_urls jsonb;
  END IF;
END $$;

-- 3. Set default to '[]'::jsonb
ALTER TABLE public."Staff"
  ALTER COLUMN gallery_urls SET DEFAULT '[]'::jsonb;

-- 4. Backfill any NULL rows
UPDATE public."Staff"
SET gallery_urls = '[]'::jsonb
WHERE gallery_urls IS NULL;

-- 5. Notify PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
