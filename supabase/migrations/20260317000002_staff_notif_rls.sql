-- Fix Realtime: Enable RLS on StaffNotifications so Supabase can broadcast realtime events
-- Without RLS enabled, postgres_changes realtime does NOT send events to anon/auth clients

ALTER TABLE public."StaffNotifications" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read notifications
-- (Filtering by role is done client-side in NotificationProvider)
CREATE POLICY IF NOT EXISTS "staff_notif_read_auth"
  ON public."StaffNotifications" FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role (API routes) to insert
CREATE POLICY IF NOT EXISTS "staff_notif_insert_service"
  ON public."StaffNotifications" FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow service role to update (mark as read)
CREATE POLICY IF NOT EXISTS "staff_notif_update_auth"
  ON public."StaffNotifications" FOR UPDATE
  TO authenticated
  USING (true);
