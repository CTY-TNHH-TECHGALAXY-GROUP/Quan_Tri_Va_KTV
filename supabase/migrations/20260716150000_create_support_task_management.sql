-- 1. Drop old tables safely
DROP TABLE IF EXISTS "SupportTasks" CASCADE;
DROP TABLE IF EXISTS "SupportAreas" CASCADE;
DROP TABLE IF EXISTS "SupportTaskTemplates" CASCADE;

-- 2. Create TaskCategories
CREATE TABLE "TaskCategories" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create TaskTemplates
CREATE TABLE "TaskTemplates" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES "TaskCategories"(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    requires_photo BOOLEAN DEFAULT true,
    min_photo_count INTEGER DEFAULT 1,
    cron_schedule TEXT,
    room_id TEXT REFERENCES "Rooms"(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_by TEXT REFERENCES "Users"(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Tasks
CREATE TABLE "Tasks" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES "TaskTemplates"(id) ON DELETE SET NULL,
    category_id UUID REFERENCES "TaskCategories"(id) ON DELETE SET NULL,
    room_id TEXT REFERENCES "Rooms"(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN ('FIXED', 'AD-HOC')),
    assignee_id TEXT REFERENCES "Staff"(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'UNABLE_TO_COMPLETE')),
    inspection_status TEXT NOT NULL DEFAULT 'NOT_REVIEWED' CHECK (inspection_status IN ('NOT_REVIEWED', 'PENDING_REVIEW', 'PASSED', 'FAILED', 'REWORK_REQUIRED')),
    due_at TIMESTAMPTZ,
    priority TEXT DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
    current_review_round INTEGER DEFAULT 0,
    created_by TEXT REFERENCES "Users"(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Create TaskPhotos
CREATE TABLE "TaskPhotos" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES "Tasks"(id) ON DELETE CASCADE,
    uploaded_by TEXT REFERENCES "Staff"(id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    is_submitted BOOLEAN DEFAULT false,
    review_round INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Create TaskReviews
CREATE TABLE "TaskReviews" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES "Tasks"(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    reviewer_id TEXT REFERENCES "Users"(id) ON DELETE SET NULL,
    decision TEXT NOT NULL CHECK (decision IN ('PASSED', 'REWORK_REQUIRED', 'FAILED')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (task_id, round_number)
);

-- Trigger to update `updated_at` on Tasks
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_tasks_updated_at
BEFORE UPDATE ON "Tasks"
FOR EACH ROW
EXECUTE FUNCTION update_tasks_updated_at();

-- Enable RLS
ALTER TABLE "TaskCategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskTemplates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskPhotos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskReviews" ENABLE ROW LEVEL SECURITY;

-- Basic Policies (allowing all authenticated users, refine based on your auth structure later)
CREATE POLICY "Enable all for authenticated users" ON "TaskCategories" FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON "TaskTemplates" FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON "Tasks" FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON "TaskPhotos" FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON "TaskReviews" FOR ALL USING (auth.role() = 'authenticated');
