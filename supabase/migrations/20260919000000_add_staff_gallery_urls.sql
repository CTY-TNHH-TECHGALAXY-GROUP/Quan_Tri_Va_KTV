DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Staff'
      AND column_name = 'gallery_urls'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE public."Staff"
      ALTER COLUMN gallery_urls TYPE jsonb
      USING to_jsonb(gallery_urls);
  ELSE
    ALTER TABLE public."Staff"
      ADD COLUMN IF NOT EXISTS gallery_urls jsonb;
  END IF;
END $$;

ALTER TABLE public."Staff"
  ALTER COLUMN gallery_urls SET DEFAULT '[]'::jsonb;

UPDATE public."Staff"
SET gallery_urls = '[]'::jsonb
WHERE gallery_urls IS NULL;
