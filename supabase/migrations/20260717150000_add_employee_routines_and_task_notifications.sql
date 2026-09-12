-- =============================================
-- Migration: Add EmployeeRoutines + TaskNotifications
-- =============================================

-- 1. EmployeeRoutines: Checklist cố định cho từng nhân viên
CREATE TABLE "EmployeeRoutines" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES "TaskTemplates"(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (employee_id, template_id)
);

-- 2. TaskNotifications: Thông báo riêng cho luồng giao việc (TÁCH khỏi StaffNotifications)
CREATE TABLE "TaskNotifications" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES "Tasks"(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('REWORK', 'NEW_TASK', 'APPROVED')),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE "EmployeeRoutines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskNotifications" ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable all for authenticated users" ON "EmployeeRoutines" FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON "TaskNotifications" FOR ALL USING (auth.role() = 'authenticated');

-- Enable Realtime for TaskNotifications (push notification to employee app)
ALTER PUBLICATION supabase_realtime ADD TABLE "TaskNotifications";
