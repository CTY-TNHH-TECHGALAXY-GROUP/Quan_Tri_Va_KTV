ALTER TABLE public."Services"
ADD COLUMN IF NOT EXISTS "strengthConfig" jsonb NOT NULL
DEFAULT '{"light":true,"medium":true,"strong":true}'::jsonb;
