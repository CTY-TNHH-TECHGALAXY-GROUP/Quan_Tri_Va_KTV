-- 1. Table for Guest Arrival Events
CREATE TABLE IF NOT EXISTS "GuestArrivalEvents" (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by text NOT NULL,
    created_by_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz NULL,
    released_by text NULL,
    note text NULL
);

-- 2. Partial unique index to ensure only 1 active lock
CREATE UNIQUE INDEX IF NOT EXISTS "GuestArrivalEvents_single_active"
ON "GuestArrivalEvents" ((released_at IS NULL))
WHERE released_at IS NULL;

-- 3. Add to publication for realtime
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'GuestArrivalEvents'
    ) THEN 
        ALTER PUBLICATION supabase_realtime ADD TABLE "GuestArrivalEvents"; 
    END IF; 
END $$;

-- 4. Seed config guest_arrival_lock_enabled = true
INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'guest_arrival_lock_enabled', 
    'true', 
    'Kích hoạt tính năng khóa tan ca khi có khách đến'
)
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value, description = EXCLUDED.description;
