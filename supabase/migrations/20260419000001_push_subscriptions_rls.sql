-- =============================================================================
-- RLS cho StaffPushSubscriptions: Cho phép client đăng ký push subscription
-- =============================================================================

-- Enable RLS
ALTER TABLE public."StaffPushSubscriptions" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "push_sub_read_own" ON public."StaffPushSubscriptions";
DROP POLICY IF EXISTS "push_sub_insert_auth" ON public."StaffPushSubscriptions";
DROP POLICY IF EXISTS "push_sub_update_auth" ON public."StaffPushSubscriptions";
DROP POLICY IF EXISTS "push_sub_read_anon" ON public."StaffPushSubscriptions";
DROP POLICY IF EXISTS "push_sub_insert_anon" ON public."StaffPushSubscriptions";
DROP POLICY IF EXISTS "push_sub_update_anon" ON public."StaffPushSubscriptions";

-- Allow authenticated users to read/insert/update
CREATE POLICY "push_sub_read_own"
  ON public."StaffPushSubscriptions" FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "push_sub_insert_auth"
  ON public."StaffPushSubscriptions" FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "push_sub_update_auth"
  ON public."StaffPushSubscriptions" FOR UPDATE
  TO authenticated
  USING (true);

-- Allow anon users too (for PWA without login session)
CREATE POLICY "push_sub_read_anon"
  ON public."StaffPushSubscriptions" FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "push_sub_insert_anon"
  ON public."StaffPushSubscriptions" FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "push_sub_update_anon"
  ON public."StaffPushSubscriptions" FOR UPDATE
  TO anon
  USING (true);
