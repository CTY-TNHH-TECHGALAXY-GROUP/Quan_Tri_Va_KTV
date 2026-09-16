-- Tạo bảng SupportTaskTemplates
CREATE TABLE IF NOT EXISTS "SupportTaskTemplates" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_name text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Tạo bảng SupportAreas
CREATE TABLE IF NOT EXISTS "SupportAreas" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    area_name text NOT NULL
);

-- Tạo bảng SupportTasks
CREATE TABLE IF NOT EXISTS "SupportTasks" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id uuid REFERENCES "SupportTaskTemplates"(id) ON DELETE CASCADE,
    task_name text NOT NULL,
    assignee_id text REFERENCES "Staff"(id) ON DELETE SET NULL,
    area_id uuid REFERENCES "SupportAreas"(id) ON DELETE SET NULL,
    status text DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE')),
    photo_url text,
    created_by text REFERENCES "Staff"(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now(),
    completed_at timestamptz
);

-- Cấp quyền RLS
ALTER TABLE "SupportTaskTemplates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAreas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTasks" ENABLE ROW LEVEL SECURITY;

-- Policies
-- Policies cho SupportTaskTemplates
DROP POLICY IF EXISTS "Allow authenticated users to read SupportTaskTemplates" ON "SupportTaskTemplates";
CREATE POLICY "Allow authenticated users to read SupportTaskTemplates" ON "SupportTaskTemplates" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert SupportTaskTemplates" ON "SupportTaskTemplates";
CREATE POLICY "Allow authenticated users to insert SupportTaskTemplates" ON "SupportTaskTemplates" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update SupportTaskTemplates" ON "SupportTaskTemplates";
CREATE POLICY "Allow authenticated users to update SupportTaskTemplates" ON "SupportTaskTemplates" FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete SupportTaskTemplates" ON "SupportTaskTemplates";
CREATE POLICY "Allow authenticated users to delete SupportTaskTemplates" ON "SupportTaskTemplates" FOR DELETE TO authenticated USING (true);

-- Policies cho SupportAreas
DROP POLICY IF EXISTS "Allow authenticated users to read SupportAreas" ON "SupportAreas";
CREATE POLICY "Allow authenticated users to read SupportAreas" ON "SupportAreas" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert SupportAreas" ON "SupportAreas";
CREATE POLICY "Allow authenticated users to insert SupportAreas" ON "SupportAreas" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update SupportAreas" ON "SupportAreas";
CREATE POLICY "Allow authenticated users to update SupportAreas" ON "SupportAreas" FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete SupportAreas" ON "SupportAreas";
CREATE POLICY "Allow authenticated users to delete SupportAreas" ON "SupportAreas" FOR DELETE TO authenticated USING (true);

-- Policies cho SupportTasks
DROP POLICY IF EXISTS "Allow authenticated users to read SupportTasks" ON "SupportTasks";
CREATE POLICY "Allow authenticated users to read SupportTasks" ON "SupportTasks" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert SupportTasks" ON "SupportTasks";
CREATE POLICY "Allow authenticated users to insert SupportTasks" ON "SupportTasks" FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update SupportTasks" ON "SupportTasks";
CREATE POLICY "Allow authenticated users to update SupportTasks" ON "SupportTasks" FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete SupportTasks" ON "SupportTasks";
CREATE POLICY "Allow authenticated users to delete SupportTasks" ON "SupportTasks" FOR DELETE TO authenticated USING (true);

-- Bật Realtime cho SupportTasks
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE "SupportTasks";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Bảng SupportTasks đã nằm trong supabase_realtime publication, bỏ qua...';
END;
$$;
