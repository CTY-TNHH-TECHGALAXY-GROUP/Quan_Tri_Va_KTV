ALTER TABLE public."Staff"
  ADD COLUMN IF NOT EXISTS gallery_urls jsonb DEFAULT '[]'::jsonb;

UPDATE public."Staff"
SET gallery_urls = COALESCE(gallery_urls, '[]'::jsonb)
WHERE gallery_urls IS NULL;
