-- Office P0 — nền tảng checklist giao việc (plans/plan_office_p0_nen_tang_checklist.md, mục 2).
-- Chỉ THÊM bảng/cột; không đổi tên, không xoá cột → code cũ trên main vẫn chạy.
-- Idempotent: chạy lại an toàn (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).

-- ============ 1. Vị trí & template bộ việc ============
CREATE TABLE IF NOT EXISTS "OfficePositions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL DEFAULT 'ORIA',
  branch text,
  name text NOT NULL,
  shift_start time,
  shift_end time,
  -- Chính sách nhận việc: MANDATORY = tự nhận, không từ chối (VD NH001)
  --                       ACCEPT_REQUIRED = phải bấm Nhận, không được từ chối
  --                       ACCEPT_OR_DECLINE = được Nhận hoặc Từ chối (kèm lý do)
  fixed_accept_policy text NOT NULL DEFAULT 'MANDATORY'
    CHECK (fixed_accept_policy IN ('MANDATORY','ACCEPT_REQUIRED','ACCEPT_OR_DECLINE')),
  adhoc_accept_policy text NOT NULL DEFAULT 'MANDATORY'
    CHECK (adhoc_accept_policy IN ('MANDATORY','ACCEPT_REQUIRED','ACCEPT_OR_DECLINE')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "OfficePositionMembers" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES "OfficePositions"(id) ON DELETE CASCADE,
  staff_id text NOT NULL,              -- Staff.id (mã NV), không FK vì Tasks.assignee cũng đã bỏ FK
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (position_id, staff_id)
);

CREATE TABLE IF NOT EXISTS "OfficeTemplateSets" (       -- "Template" = bộ việc
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL DEFAULT 'ORIA',
  name text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "OfficeTemplateSetCategories" ( -- bộ việc = danh sách nhóm việc (TaskCategories)
  set_id uuid NOT NULL REFERENCES "OfficeTemplateSets"(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES "TaskCategories"(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, category_id)
);

CREATE TABLE IF NOT EXISTS "OfficePositionTemplateSets" (
  position_id uuid NOT NULL REFERENCES "OfficePositions"(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES "OfficeTemplateSets"(id) ON DELETE CASCADE,
  PRIMARY KEY (position_id, set_id)
);

-- Chỉnh riêng từng người: ADD (mặc định, = hành vi cũ) / EXCLUDE (bỏ việc của template)
ALTER TABLE "EmployeeRoutines" ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'ADD';
ALTER TABLE "EmployeeRoutines" DROP CONSTRAINT IF EXISTS "EmployeeRoutines_mode_check";
ALTER TABLE "EmployeeRoutines" ADD CONSTRAINT "EmployeeRoutines_mode_check" CHECK (mode IN ('ADD','EXCLUDE'));

ALTER TABLE "TaskCategories" ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'ORIA';

-- ============ 2. Cấu hình việc mẫu ============
ALTER TABLE "TaskTemplates"
  ADD COLUMN IF NOT EXISTS standard_text text,              -- tiêu chuẩn đạt
  ADD COLUMN IF NOT EXISTS sop jsonb,                        -- ["bước 1", ...]
  ADD COLUMN IF NOT EXISTS photo_slots jsonb,                -- [{"label":"Sảnh","ref_path":"refs/.."}]; null → min_photo_count ô không nhãn
  ADD COLUMN IF NOT EXISTS evidence_fields jsonb,            -- [{"kind":"check","label":".."},{"kind":"count","label":"Khăn","unit":"cái","min":30}]
  ADD COLUMN IF NOT EXISTS time_mode text NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS due_time time,
  ADD COLUMN IF NOT EXISTS window_start time,
  ADD COLUMN IF NOT EXISTS window_end time,
  ADD COLUMN IF NOT EXISTS multi_times jsonb,                -- ["09:00","13:00","17:00"]
  ADD COLUMN IF NOT EXISTS blocks_checkout boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_carry_over boolean NOT NULL DEFAULT true;
ALTER TABLE "TaskTemplates" DROP CONSTRAINT IF EXISTS "TaskTemplates_time_mode_check";
ALTER TABLE "TaskTemplates" ADD CONSTRAINT "TaskTemplates_time_mode_check"
  CHECK (time_mode IN ('FREE','DEADLINE','WINDOW','MULTI'));

-- ============ 3. Việc thực tế (snapshot tại lúc giao) ============
ALTER TABLE "Tasks"
  ADD COLUMN IF NOT EXISTS task_date date,                   -- ngày nghiệp vụ VN
  ADD COLUMN IF NOT EXISTS slot_time text,                   -- mốc của MULTI
  ADD COLUMN IF NOT EXISTS dedupe_key text,                  -- chống sinh trùng (FIXED)
  ADD COLUMN IF NOT EXISTS position_id uuid,
  ADD COLUMN IF NOT EXISTS standard_text text,
  ADD COLUMN IF NOT EXISTS sop jsonb,
  ADD COLUMN IF NOT EXISTS photo_slots jsonb,
  ADD COLUMN IF NOT EXISTS evidence_fields jsonb,
  ADD COLUMN IF NOT EXISTS evidence_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS time_mode text NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS window_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS window_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocks_checkout boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_carry_over boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS acceptance_status text NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_reason text,
  ADD COLUMN IF NOT EXISTS assigned_by text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_slots jsonb,             -- [{"slot":1,"reason":"..","mark":{"x":62,"y":48}}] của vòng hiện tại
  ADD COLUMN IF NOT EXISTS blocked_reason text,              -- Báo vướng (status = PAUSED)
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,         -- huỷ mềm thay cho DELETE
  ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE "Tasks" DROP CONSTRAINT IF EXISTS "Tasks_acceptance_status_check";
ALTER TABLE "Tasks" ADD CONSTRAINT "Tasks_acceptance_status_check"
  CHECK (acceptance_status IN ('AUTO','PENDING','ACCEPTED','DECLINED'));

-- Backfill ngày nghiệp vụ cho dữ liệu cũ (≈4.900 dòng)
UPDATE "Tasks" SET task_date = (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date WHERE task_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Tasks_dedupe_key_uidx" ON "Tasks"(dedupe_key);   -- NULL không đụng nhau → dữ liệu cũ an toàn
CREATE INDEX IF NOT EXISTS "Tasks_assignee_date_idx" ON "Tasks"(assignee_id, task_date);

-- ============ 4. Bằng chứng & duyệt ============
ALTER TABLE "TaskPhotos"
  ADD COLUMN IF NOT EXISTS slot_index integer,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;        -- ảnh bị thay: giữ lại làm lịch sử
ALTER TABLE "TaskReviews"
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS rejected_slots jsonb;

-- ============ 5. Nhật ký & cho tan ca ============
CREATE TABLE IF NOT EXISTS "TaskEvents" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES "Tasks"(id) ON DELETE CASCADE,
  actor_id text,
  type text NOT NULL,         -- ASSIGNED|ACCEPTED|DECLINED|PHOTO|EVIDENCE|SUBMITTED|APPROVED|RETURNED|BLOCKED|UNBLOCKED|CANCELLED (P1: COMMENTED, RESCHEDULE_*)
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "TaskEvents_task_idx" ON "TaskEvents"(task_id, created_at);

CREATE TABLE IF NOT EXISTS "CheckoutOverrides" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id text NOT NULL,
  business_date date NOT NULL,
  reason text NOT NULL,
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, business_date)
);

-- RLS: bảng mới chỉ đi qua API (service role) — bật RLS, không mở policy cho client
ALTER TABLE "OfficePositions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficePositionMembers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficeTemplateSets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficeTemplateSetCategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficePositionTemplateSets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskEvents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckoutOverrides" ENABLE ROW LEVEL SECURITY;

-- Realtime cho hàng chờ duyệt (probe trước: bỏ qua nếu đã có trong publication)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='Tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "Tasks";
  END IF;
END $$;
