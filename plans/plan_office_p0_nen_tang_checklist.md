# Plan P0 — Nền tảng Office: Checklist giao việc (tận dụng module Hậu cần)

> **Mức 2** — chạm DB (migration), chấm công / chặn tan ca, phân quyền, cron, "xoá" dữ liệu (đổi sang huỷ mềm).
> Trạng thái: **ĐÃ DUYỆT 08/10** — đang làm. Nhánh: `feat/office-p0-checklist-v1` (worktree `.worktrees/office-p0-v1`, `.env.local` = Supabase TEST).
> Tiến độ: bước 1 migration ✅ TEST · bước 2 service + cổng tan ca ✅ · bước 3 API ✅ — `6a09fa3a` · bước 4 UI nhân viên ✅ — `da7c3aa2` · bước 5 UI giám sát/admin ✅ — `ca5e40c3` · bước 6 seed NH01 ✅ trên TEST (QA28 đạt, chạy lại không trùng) · bước 7 RLS chỉ-đọc + dọn code ✅ trên TEST (QA27 86 · QA28 · QA29 đạt). DB thật: **chưa apply** migration, **chưa seed**. UI **chưa xem bằng mắt khi đăng nhập**.
> Thay thế: `plans/plan_nang_cap_giao_viec.md` (giữ làm lịch sử; các quyết định ở mục 9 của file đó vẫn áp dụng).
> Bối cảnh: `plans/context_giao_viec_v2.md`. Demo duyệt UX: https://claude.ai/artifact/YJcAZMkAGQZbHNZtj5vGk3

---

## 0. Phạm vi P0

**Làm:** checklist cố định + giao đột xuất chạy trên **lõi tái sử dụng được cho Office sau này**:
vị trí (có chính sách nhận/từ chối) · template bộ việc → chỉnh riêng từng người · bằng chứng theo ô có nhãn + số liệu + xác nhận · chế độ thời gian · duyệt / trả lại theo ô · báo vướng · nhật ký sự kiện · chặn tan ca (có "cho tan ca") · sinh việc chắc chắn, không trùng.

**Không làm ở P0** (đã có chỗ trong schema, làm ở P1+): bình luận/trao đổi trong việc (UI), xin dời hạn, phân vị trí theo từng ngày, phiên bản template + ngày hiệu lực, đa tổ chức (chỉ thêm `org_id`), gom các lý do chặn tan ca (nợ phòng) về 1 chỗ, AI kiểm ảnh, chat.

**Nguyên tắc không lệch hướng:**
1. Việc cố định do vị trí bắt buộc (VD NH001) **không có nút từ chối** — chính sách đặt ở vị trí.
2. Xong = **đủ bằng chứng + được duyệt** (trừ việc cấu hình `requires_review=false`).
3. Chặn tan ca khi còn việc chưa duyệt, gồm **việc tồn hôm qua**; báo off đột xuất **miễn**; giám sát **"Cho tan ca"** có lý do.
4. Không xoá bằng chứng, không xoá việc ngầm.

---

## 1. Tận dụng codebase cũ

| Thành phần | Quyết định | Ghi chú |
|---|---|---|
| Bảng `TaskCategories`, `TaskTemplates`, `Tasks`, `TaskPhotos`, `TaskReviews`, `TaskNotifications`, `EmployeeRoutines`, `RoomTaskTemplates` | **Giữ, thêm cột** | Không đổi tên / không xoá cột → code trên `main` vẫn chạy |
| `status` + `inspection_status` | **Giữ** | Trạng thái hiển thị tính ở **1 hàm** `deriveTaskState()` |
| `status = 'PAUSED'` (đã có trong CHECK) | **Tái dùng** cho "Báo vướng" | Không cần đổi constraint |
| `lib/services/employeeTasks.service.ts` | **Sửa & mở rộng** — thành service lõi | ~60% code giữ (lọc nghỉ phép, lặp tuần, việc phòng, việc tồn, map dữ liệu) |
| `app/api/support/tasks/upload/route.ts` | **Giữ**, thêm `slotIndex` + thay ảnh mềm | Đã có auth + kiểm magic bytes |
| `app/api/support/tasks/rework-photo/route.ts` | **Giữ** | Ảnh lỗi của giám sát |
| `app/api/support/routines/route.ts` | **Giữ**, thêm huỷ mềm việc hôm nay khi gỡ | |
| `lib/camera.logic.ts` `compressImageWithWatermark` | **Giữ** | Nén + kiểm ảnh tối |
| Toggle "phòng có khách" | **Giữ** | |
| `app/admin/support/templates/*` | **Giữ**, thêm form cấu hình việc | |
| `app/admin/support/employee/[id]/*` | **Giữ**, chuyển ghi DB sang API | |
| `app/admin/support/reviews/*` | **Viết lại UI** thành "Cần tôi xử lý" | Logic cũ ghi thẳng DB, không ghi TaskReviews |
| `app/support/tasks/page.tsx` | **Viết lại UI** theo demo | Logic hook giữ khung |
| Chặn tan ca ở 4 route | **Gom** về `getCheckoutBlockers()` | |
| `app/support/dashboard/*` (hỏng) | **Thay bằng redirect** | |
| `app/api/support/tasks/rework/route.ts` (xoá ảnh) | **Xoá** | Thay bằng thay-ảnh-mềm |
| Code chết: `app/admin/support-tasks/*`, `api/support/templates/route.ts`, `api/support/areas/route.ts`, `api/support/tasks/[id]/photos`, `api/support/tasks/[id]/status`, `api/support/tasks/[id]/review`, `lib/support-task.service.ts` | **Xoá** (bước cuối, grep lại trước) | Tham chiếu bảng đã DROP / trùng chức năng |

Ước tính: giữ ~65% backend, ~35% UI (UI nhân viên & hàng chờ duyệt viết lại theo demo).

---

## 2. Migration — `supabase/migrations/20261009090000_office_p0_checklist_foundation.sql`

Chỉ **thêm**. Cập nhật `TableInSupabase.md` cùng commit.

```sql
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
```

Rollback migration: các cột/bảng mới không được code cũ đọc → để nguyên vô hại; nếu cần gỡ, `DROP TABLE` 7 bảng mới + `DROP COLUMN` (ghi sẵn file `..._rollback.sql`, không chạy tự động).

---

## 3. Service lõi — `lib/services/employeeTasks.service.ts`

### 3.1. Trạng thái — một nguồn duy nhất (mới)

```ts
export type TaskState = 'OFFERED' | 'TODO' | 'DOING' | 'WAITING' | 'FIX' | 'APPROVED' | 'BLOCKED' | 'DECLINED' | 'CANCELLED';

export const deriveTaskState = (t: TaskRow, doneSlots: number, totalSlots: number): TaskState => {
  if (t.cancelled_at) return 'CANCELLED';
  if (t.acceptance_status === 'DECLINED') return 'DECLINED';
  if (t.acceptance_status === 'PENDING') return 'OFFERED';
  if (t.inspection_status === 'PASSED') return 'APPROVED';
  if (!t.requires_review && t.status === 'COMPLETED') return 'APPROVED';
  if (t.status === 'PAUSED') return 'BLOCKED';
  if (t.inspection_status === 'REWORK_REQUIRED') return 'FIX';
  if (t.inspection_status === 'PENDING_REVIEW') return 'WAITING';
  return doneSlots === 0 ? 'TODO' : 'DOING';
};

// Việc còn chặn tan ca?
export const isCheckoutBlocking = (s: TaskState) => !['APPROVED', 'DECLINED', 'CANCELLED'].includes(s);
```

### 3.2. Danh sách việc hiệu lực của 1 người (mới)

```ts
// Template từ vị trí  ∪  routine ADD  −  routine EXCLUDE
static async resolveEffectiveRoutines(supabase, staffId: string) {
  const { data: members } = await supabase.from('OfficePositionMembers')
    .select('position_id, OfficePositions!inner(id, is_active, fixed_accept_policy)')
    .eq('staff_id', staffId).eq('is_active', true);
  const positionIds = (members || []).filter(m => m.OfficePositions?.is_active).map(m => m.position_id);
  // positions → sets → categories → templates (room_id = null)
  // + EmployeeRoutines(mode='ADD', is_active) ; − EmployeeRoutines(mode='EXCLUDE', is_active)
  // trả: [{ template_id, room_id, position_id|null, accept_policy, TaskTemplates{...} }]
}
```

### 3.3. `generateTodayTasks` → `ensureTasksForDate(staffId, dateStr?)` (diff)

```diff
-  static generationLocks = new Set<string>();
-  static async generateTodayTasks(empIds: string[], includeRoomTasks: boolean = true) {
-    const lockKey = empIds.join(',');
-    if (this.generationLocks.has(lockKey)) { ... return { reason: 'GENERATING' } }
-    this.generationLocks.add(lockKey);
+  // Idempotent nhờ Tasks.dedupe_key (unique) — gọi bao nhiêu lần, từ bao nhiêu instance cũng không trùng.
+  static async ensureTasksForDate(staffId: string, dateStr: string = getVnDateStr(), includeRoomTasks = true) {
-    const todayStr = new Date().toLocaleDateString('en-CA'); // UTC trên server → sai 00:00–07:00 VN
+    const todayStr = dateStr;                                 // ngày VN (lib/time.logic getVnDateStr)
     // (giữ) kiểm KTVLeaveRequests + DailyAttendance theo todayStr
-    const { data: routines } = await supabase.from('EmployeeRoutines')...in('employee_id', empIds)
+    const routines = await EmployeeTasksService.resolveEffectiveRoutines(supabase, staffId);
-    // Cleanup stale FIXED tasks ... .delete()            ← BỎ (L12)
-    // Cleanup WEEKLY tasks generated on wrong day .delete()  ← BỎ (lọc ngày đã đúng giờ VN)
-    // Cleanup stale shared room tasks .delete()          ← BỎ
     const newTasks = routines.filter(shouldGenerate).flatMap(r => {
+      const tpl = r.TaskTemplates;
+      const times = tpl.time_mode === 'MULTI' ? (tpl.multi_times || []) : [null];
+      return times.map(slotTime => ({
         template_id: r.template_id, room_id: r.room_id || null, category_id: tpl.category_id,
         name: slotTime ? `${tpl.name} — ${slotTime}` : tpl.name,
         task_type: 'FIXED',
-        assignee_id: empIds[0],
+        assignee_id: staffId,                              // luôn Staff.id (mã NV)
+        task_date: todayStr, slot_time: slotTime, position_id: r.position_id,
+        dedupe_key: `F|${staffId}|${r.template_id}|${r.room_id || ''}|${todayStr}|${slotTime || ''}`,
+        acceptance_status: r.accept_policy === 'MANDATORY' ? 'AUTO' : 'PENDING',
+        ...snapshotFromTemplate(tpl, todayStr, slotTime),   // standard_text, sop, photo_slots, evidence_fields,
+                                                           // time_mode, due_at, window_*_at, blocks_checkout,
+                                                           // requires_review, allow_carry_over, min_photo_count
         status: 'NOT_STARTED', inspection_status: 'NOT_REVIEWED', priority: 'NORMAL', sort_order: tpl.sort_order || 0,
-      };
+      }));
     });
-    await supabase.from('Tasks').insert(newTasks);
+    await supabase.from('Tasks').upsert(newTasks, { onConflict: 'dedupe_key', ignoreDuplicates: true });
     // (giữ) việc phòng dùng chung assignee_id = null — thêm dedupe_key `R|room|template|date`
```

`fetchTasks(staffId)` (diff chính): đọc theo `task_date` thay `created_at`; bỏ `customPhotoMap` khi task đã có `photo_slots` snapshot; trả thêm `state` (từ 3.1), `slots[]` (ảnh hiện hành theo `slot_index`, `superseded_at IS NULL`), `evidence`, `rejectedSlots`, `acceptance`, `events` (20 dòng cuối). Việc tồn: `task_date = hôm qua` và `allow_carry_over` và `isCheckoutBlocking`.

### 3.4. Chặn tan ca — `getCheckoutBlockers()` (mới, thay 4 bản copy)

```ts
// Fail-open: lỗi bất kỳ → không chặn, chỉ log. Lỗi module giao việc không được làm KTV kẹt ca.
export async function getCheckoutBlockers(supabase, staffId: string, workTypeKey: string) {
  try {
    const { data: cfg } = await supabase.from('SystemConfigs').select('value')
      .eq('key', `block_checkout_incomplete_tasks_${workTypeKey}`).maybeSingle();
    if (!cfg?.value) return { enabled: false, count: 0, items: [] };
    const today = getVnDateStr();
    try { await EmployeeTasksService.ensureTasksForDate(staffId, today); } catch (e) { console.error('[blockers] ensure', e); }
    const { data: ov } = await supabase.from('CheckoutOverrides').select('reason, granted_by')
      .eq('staff_id', staffId).eq('business_date', today).maybeSingle();
    if (ov) return { enabled: true, count: 0, items: [], override: ov };
    const yesterday = shiftVnDate(today, -1);
    const { data } = await supabase.from('Tasks')
      .select('id, name, task_date, status, inspection_status, requires_review, acceptance_status, cancelled_at, blocks_checkout, allow_carry_over')
      .eq('assignee_id', staffId).in('task_date', [yesterday, today]).eq('blocks_checkout', true).is('cancelled_at', null);
    const items = (data || [])
      .filter(t => t.task_date === today || t.allow_carry_over)
      .map(t => ({ ...t, state: deriveTaskState(t, 0, 0) }))
      .filter(t => isCheckoutBlocking(t.state))
      .map(t => ({ id: t.id, name: t.name, state: t.state, carry: t.task_date !== today }));
    return { enabled: true, count: items.length, items };
  } catch (e) {
    console.error('[getCheckoutBlockers] fail-open', e);
    return { enabled: true, count: 0, items: [], error: true };
  }
}
```

### 3.5. Thao tác việc (mới, đều ghi `TaskEvents`)

| Hàm | Ai | Kiểm tra ở server |
|---|---|---|
| `acceptTask(id, actor)` | người nhận | `acceptance_status='PENDING'` |
| `declineTask(id, actor, reason)` | người nhận | chính sách vị trí = `ACCEPT_OR_DECLINE`; lý do bắt buộc; báo người giao |
| `setEvidence(id, actor, values)` | người nhận | trạng thái cho sửa; `count` là số ≥ 0 |
| `onPhotoUploaded(id, slotIndex)` | (upload route gọi) | ảnh cũ cùng ô → `superseded_at = now()`; bỏ ô khỏi `rejected_slots` |
| `trySubmit(id)` | tự động | **đủ mọi ô ảnh + mọi trường** + trong khung nếu `WINDOW`; → `status=COMPLETED`, `inspection_status = requires_review ? 'PENDING_REVIEW' : 'PASSED'`, `submitted_at` |
| `blockTask / unblockTask` | người nhận / giám sát | → `status=PAUSED` + `blocked_reason` / về `IN_PROGRESS` |
| `reviewTasks(ids[], reviewer, decision, {reasonCode, note, rejectedSlots, photoPath})` | `support_tasks_admin` | chỉ việc `PENDING_REVIEW`; `REWORK` bắt buộc ≥1 ô + lý do; ghi `TaskReviews` (`reviewer_id` từ session), `reviewed_by/at`, `TaskNotifications` |
| `createAdhocTask(input, assigner)` | `support_tasks_admin` | `acceptance_status` theo `adhoc_accept_policy` của vị trí người nhận; `TaskNotifications NEW_TASK` |
| `cancelTask(id, actor, reason)` | `support_tasks_admin` | huỷ mềm thay `DELETE` |
| `grantCheckoutOverride(staffId, actor, reason)` | `support_tasks_admin` | lý do bắt buộc; upsert `CheckoutOverrides` |

---

## 4. API — diff

| Route | Thay đổi |
|---|---|
| `GET /api/support/tasks` | `+ requireStaffOrPermission(employeeId, 'support_tasks_admin')`; staffId lấy từ session (`techCode`), không tin `userCode` client; gọi `ensureTasksForDate` + `fetchTasks` |
| `POST /api/support/tasks` | `+ auth`; action: `ACCEPT`, `DECLINE{reason}`, `EVIDENCE{values}`, `BLOCK{reason,note}`, `UNBLOCK`; `START` giữ (no-op tương thích); `COMPLETE` → `trySubmit` (**kiểm đủ ở server**) |
| `POST /api/support/tasks/upload` | `+ slotIndex` (bắt buộc với việc có `photo_slots`); kiểm task thuộc người gọi & trạng thái cho chụp; gọi `onPhotoUploaded` + `trySubmit`; trả `state` mới |
| `DELETE /api/support/tasks/photo?id=` **(mới)** | thay xoá ảnh trực tiếp từ client: đặt `superseded_at`, không xoá file |
| `POST /api/support/tasks/review` **(mới)** | duyệt/trả lại 1 hoặc nhiều việc (thay ghi thẳng DB ở `EmployeeDetail.logic.ts` và `SupportReviews.logic.ts`) |
| `POST /api/support/tasks/adhoc` **(mới)** | giao đột xuất (thay insert client; sửa nút "Giao việc nóng") |
| `POST /api/support/tasks/cancel` **(mới)** | huỷ mềm (thay `DELETE` client) |
| `GET /api/support/review-queue` **(mới)** | hàng chờ duyệt + báo vướng + tình trạng tan ca theo người, sắp theo giờ hết ca |
| `POST /api/support/checkout-override` **(mới)** | cho tan ca có lý do |
| `GET/POST/PATCH /api/support/positions` **(mới)** | vị trí, chính sách nhận việc, thành viên, gắn bộ việc |
| `GET/POST/PATCH /api/support/template-sets` **(mới)** | bộ việc = danh sách nhóm việc |
| `DELETE /api/support/routines` | `+` huỷ mềm việc **hôm nay** chưa bắt đầu của routine bị gỡ (thay cơ chế xoá ngầm) |
| `GET /api/cron/generate-tasks` **(mới)** | `requireCronAuth`; chạy `ensureTasksForDate` cho mọi thành viên vị trí + người có routine ADD; `vercel.json`: `"5 17 * * *"` (00:05 VN) — **chỉ chạy sau khi merge main**, trước đó đã có check-in + chặn tan ca tự sinh |
| `DELETE /api/support/tasks/rework` | **xoá route** |

---

## 5. Chấm công — diff

`app/api/ktv/attendance/route.ts` (khối Step 0.5, dòng ~145):
```diff
-        if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') {
-            const { data: staffRow } = await supabase.from('Staff').select('work_type').eq('id', staffCode).single();
-            let shouldBlock = false;
-            if (staffRow?.work_type) { ...SystemConfigs... }
-            if (shouldBlock) { ...query Tasks created_at hôm nay... return 403 }
+        if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') {
+            const { data: staffRow } = await supabase.from('Staff').select('work_type').eq('id', staffCode).single();
+            const isSuddenOff = selectedShiftType === 'SUDDEN_OFF_CHECKOUT';   // quyết định 08/10: báo off đột xuất miễn chặn
+            if (!isSuddenOff && staffRow?.work_type) {
+                const blockers = await getCheckoutBlockers(supabase, staffCode, staffRow.work_type);
+                if (blockers.count > 0) {
+                    return NextResponse.json({ success: false, error: `Bạn còn ${blockers.count} việc chưa được duyệt. Mở "Việc của tôi" để xem.`, taskBlockers: blockers.items }, { status: 403 });
+                }
+            }
             // (giữ nguyên) Validation riêng cho TYPE_D khi checkout
```
Sau khi ghi CHECK_IN thành công: `after(() => EmployeeTasksService.ensureTasksForDate(staffCode).catch(console.error))` (`next/server` — Next 15) → sinh việc không làm chậm check-in và không làm hỏng check-in.

`app/api/ktv/attendance/status/route.ts` (dòng ~155–188): thay khối query bằng `getCheckoutBlockers(..., { ensure: false })` — route này bị gọi liên tục nên **chỉ đọc**, không sinh việc (việc đã sinh lúc check-in; lúc bấm tan ca thật sẽ sinh lại cho chắc); giữ field `incompleteTasksCount` (UI cũ + `AttendanceTypeB` đang dùng), **thêm** `taskBlockers` (items) và `checkoutOverride`.

`app/api/ktv/on-call/route.ts` (~100) và `app/api/ktv/type-d/on-call/route.ts` (~102): thay query bằng `getCheckoutBlockers(supabase, techCode, workTypeKey)` — giữ nguyên cách chọn key (`TYPE_C`/`TYPE_B`, `TYPE_D`).

`app/ktv/attendance/page.tsx` (~680): dòng cảnh báo hiện **danh sách** việc từ `taskBlockers` + nút "Mở việc của tôi" (`/support/tasks`); hiện "Giám sát đã cho tan ca: …" khi có override.

---

## 6. Giao diện (theo demo)

**Nhân viên — `app/support/tasks/`** (viết lại UI, giữ route & hook):
- `page.tsx` (gọn) · `SupportTasks.i18n.ts` · `SupportEmployeeTasks.logic.ts` (sửa: kiểu dữ liệu mới, action mới, hàng chờ ảnh)
- `_components/ShiftHeader.tsx` (tiến độ theo trạng thái, trạng thái tan ca) · `TaskFilters.tsx` (trạng thái + khu vực) · `TaskCard.tsx` (thu gọn/mở) · `PhotoSlot.tsx` (ảnh mẫu góc ô, chạm để chụp, badge gửi/chờ mạng/chụp lại, vòng khoanh lỗi) · `EvidenceField.tsx` (xác nhận / số lượng) · `AcceptBar.tsx` (Nhận / Từ chối — **chỉ hiện khi chính sách cho phép**) · `StuckForm.tsx` · `CheckoutCheckSheet.tsx` (phải làm / cần sửa / chờ duyệt)
- Hàng chờ ảnh P0: giữ trong bộ nhớ + thử lại khi sự kiện `online`; IndexedDB để P1.
- `app/support/dashboard/page.tsx` → `redirect('/support/tasks')`.

**Giám sát — `app/admin/support/reviews/`** → "Cần tôi xử lý": tab Chờ duyệt (ảnh mẫu ↔ ảnh nộp, duyệt hàng loạt, trả lại theo ô + khoanh + lý do chọn sẵn), Báo vướng (xử lý / miễn hôm nay), Nhân viên & tan ca (cho tan ca); realtime `Tasks`.

**Admin:**
- `app/admin/support/templates/` — form việc mẫu thêm: tiêu chuẩn, SOP, ô ảnh có nhãn + ảnh mẫu từng ô, trường số liệu/xác nhận, chế độ thời gian, cờ chặn tan ca / cần duyệt / cho tồn.
- `app/admin/support/positions/` **(mới)** — vị trí: ca, thành viên, bộ việc, và **cấu hình nhận việc do admin chọn** (chốt 08/10: đây là nút cấu hình, không phải giá trị cố định trong code):

  | Nút cấu hình (mỗi vị trí) | Lựa chọn hiển thị cho admin | Giá trị lưu |
  |---|---|---|
  | Việc cố định (checklist) | **Bắt buộc làm** — tự nhận, không có nút từ chối | `MANDATORY` |
  | | **Phải bấm Nhận** — không được từ chối | `ACCEPT_REQUIRED` |
  | | **Được nhận hoặc từ chối** (kèm lý do) | `ACCEPT_OR_DECLINE` |
  | Việc đột xuất | (3 lựa chọn như trên) | |

  - Đổi cấu hình chỉ áp dụng cho **việc giao sau thời điểm đổi**; việc đã giao giữ `acceptance_status` cũ (ghi `TaskEvents` + hiện cảnh báo trong form).
  - Chỉ người có quyền `support_tasks_admin` thấy và sửa; API `PATCH /api/support/positions` kiểm quyền ở server.
  - Giá trị khi tạo vị trí mới chỉ là gợi ý ban đầu; admin chọn lại tuỳ ý.
- `app/admin/support/employee/[id]/` — thêm phần "Chỉnh riêng" (ADD/EXCLUDE so với template); mọi ghi DB đổi sang API mục 4.
- `components/layout/Sidebar.tsx` — thêm "Vị trí & bộ việc" (quyền `support_tasks_admin`).

---

## 7. Dữ liệu ban đầu

`scripts/office/seed_nh01_checklist.ts` (chạy **TEST DB** trước, rồi DB thật khi được duyệt):
1. Tạo nhóm việc theo 7 khung NH01 + 1 nhóm tuần; tạo 43 + 13 việc mẫu với `photo_slots` có nhãn (VD "Set up máy sấy" → `["Phòng gội","Sảnh"]`; "Thay khăn lau tay" → `MULTI 09:00/13:00/17:00` × `["Phòng gội","Toilet lầu 1","Toilet Yumi","VIP 4"]`; "Kiểm kê" → `evidence_fields` số lượng).
2. Tạo bộ việc "Quầy hỗ trợ — Ngày", "Quầy hỗ trợ — Tuần"; vị trí "Quầy hỗ trợ NH01" (`MANDATORY`/`MANDATORY`), thành viên NH001.
3. Routine cũ của NH001 (120 dòng) trùng việc của bộ → `is_active=false` (dedupe_key đã chặn trùng, bước này để màn admin sạch). Ảnh mẫu: upload sau qua màn admin.

---

## 8. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV / nhân viên | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn / API | `/support/tasks`, `/ktv/attendance`, `/api/ktv/attendance`, `/status`, `/on-call`, `/type-d/on-call` | `/admin/support/{templates,employee,reviews,positions,dashboard}` | `employeeTasks.service.ts`, Task*, Office*, `SystemConfigs.block_checkout_*` | Sửa |
| Số liệu | Số việc chặn tan ca, tiến độ | Hàng chờ, tiến độ theo người | `deriveTaskState` + `getCheckoutBlockers` | Khớp — 1 nguồn |
| Realtime | `TaskNotifications` (giữ) | + `Tasks` | `supabase_realtime` | Cần thêm (migration) |
| Quyền | Chỉ việc của mình; nút Từ chối theo chính sách vị trí | `support_tasks_admin` | `auth-server.ts` (không sửa) | Không lộ dữ liệu |
| Tiền / tua / giờ / ví | Không ảnh hưởng — module không ghi ledger | Không ảnh hưởng | — | Không ảnh hưởng |
| Luồng khách | Không — WebBooking / WRB không đọc Task* (đã `git grep` 08/10) | | | Không ảnh hưởng |

## 9. Vùng nổ (mục 4.5)

1. **Dùng chung gì?** Route chấm công `CHECK_OUT`, tắt nhận đơn (KTV thường, Loại D), trạng thái chấm công — **đường nóng** của mọi KTV có cờ chặn bật (hiện chỉ `TYPE_A = true`).
2. **Sai thì sập gì?** Lỗi `getCheckoutBlockers` → KTV không tan ca được. **Chặn:** fail-open (mục 3.4). Lỗi sinh việc lúc check-in → **không** ảnh hưởng check-in (`after()` + catch). Giám sát vắng cuối ca → nút "Cho tan ca".
3. **Luồng khách?** Không — vì không app khách nào đọc các bảng này.
4. **Cô lập?** Chấm công chỉ gọi 1 hàm; không thêm cột vào select chính của chấm công; bảng mới tách tên `Office*`.

## 10. ⚠️ Ảnh hưởng vận hành (trình lại trước commit — mục 5.1)

- **Ai đang có việc cố định (probe 08/10):** NH001 (Phát, TYPE_A, 120 việc), **NH016 (Tieu Kim Nghi, TYPE_A, 8 việc từ tháng 8)**, NH079 (đang khoá), tài khoản Developer.
- Hôm nay họ **không bị chặn** vì việc chỉ sinh khi mở trang. Sau P0, việc sinh lúc check-in → **NH016 sẽ bị chặn tan ca** nếu 8 việc cũ chưa được duyệt. → **Cần chốt** (câu hỏi 1).
- NH001: giao diện mới, không có nút Từ chối, bị chặn tan ca kể cả việc tồn hôm qua.
- Giám sát: phải duyệt trước giờ tan ca hoặc bấm "Cho tan ca".
- Cần báo trước quầy + nhân viên 1 ngày.

## 11. Kiểm thử — `scripts/qa/qa_27_office_checklist_test_db.ts` (`npm run test:office-db`, TEST DB, `TZ=UTC`)

> 08/10: bước 2 **ĐẠT 31/31** trên TEST (sinh việc, chống trùng song song, chính sách nhận việc, deriveTaskState, cổng chặn tan ca gồm việc tồn / override / fail-open / ensure:false).

- Gọi `ensureTasksForDate` song song 5 lần → số việc không đổi.
- 00:30 VN: `task_date` đúng ngày VN; nghỉ phép đúng ngày.
- Template ∪ ADD − EXCLUDE ra đúng danh sách; trùng template + ADD không sinh 2 việc.
- `MULTI` 3 mốc → 3 việc; `WINDOW` ngoài khung → server từ chối nộp.
- Nộp thiếu 1 ô / thiếu 1 trường số → server từ chối; đủ → tự sang chờ duyệt; `requires_review=false` → duyệt luôn.
- Trả lại 1 ô → chụp lại ô đó → ảnh cũ còn (`superseded_at`), ô khác giữ, `TaskReviews` có `reviewer_id`.
- Chính sách: `MANDATORY` → `DECLINE` bị 403; `ACCEPT_OR_DECLINE` → từ chối không chặn tan ca, người giao nhận thông báo.
- Chặn tan ca: việc hôm nay chưa duyệt / tồn hôm qua (`allow_carry_over`) / `blocks_checkout=false` / huỷ mềm / override / báo off đột xuất / service ném lỗi → fail-open.
- Không mở trang: check-in → checkout → vẫn bị chặn (L1).
- Gỡ routine giữa ngày → việc hôm nay chưa làm bị huỷ mềm, không chặn.

## 12. Thứ tự triển khai (mỗi bước 1 commit, chạy được độc lập)

1. Migration → apply **TEST DB** → probe cột/bảng → apply DB thật (xin duyệt riêng).
2. Service lõi + `getCheckoutBlockers` + 4 route chấm công (tắt cờ chặn trên TEST để so trước/sau).
3. API mục 4 + chuyển mọi ghi DB phía client sang API.
4. UI nhân viên.
5. UI giám sát + admin (vị trí, cấu hình việc mẫu).
6. Seed NH01 (TEST → thật) + cron.
7. Xoá code chết; thu hẹp RLS bảng Task* cho client còn `SELECT` (sau khi grep không còn ghi trực tiếp).

**Lùi:** revert commit bước 2 trả chặn tan ca về cách cũ; cột/bảng mới để nguyên vô hại. Có thể tắt nhanh bằng `SystemConfigs.block_checkout_incomplete_tasks_TYPE_A = false`.

## 12.1. Phát hiện khi làm (08/10)

- Bước 3 thêm xác thực cho `GET/POST /api/support/routines` và `/api/support/tasks/rework-photo` (trước đó không kiểm quyền). `/api/support/templates/available`, `/api/support/room-stats` vẫn chưa có — để bước 7.
- `/api/support/tasks/rework` (UI admin cũ còn gọi) **không xoá ảnh nữa**, chỉ đánh dấu `superseded_at`. Bỏ hẳn khi thay UI.
- UI cũ còn ghi thẳng DB từ client (`EmployeeDetail.logic.ts`, `SupportReviews.logic.ts`, xoá ảnh ở `SupportEmployeeTasks.logic.ts`) — chuyển sang API ở bước 4–5.

- `Tasks.assignee_id → Staff(id)` **vẫn còn FK trên cả TEST và DB thật** — migration `20260727182200_drop_tasks_assignee_fk.sql` chưa từng được apply. Không chặn P0 vì code mới luôn dùng `Staff.id`; nhưng việc giao cho người không có dòng `Staff` sẽ lỗi (đúng hành vi cũ).
- `EmployeeRoutines.employee_id → Users(id)` còn `Tasks.assignee_id → Staff(id)`: service dùng `Staff.id` làm người nhận và nhận thêm `aliasIds` (Users.id) để đọc routine cũ.

## 13. Cần chốt trước khi code

1. **NH016** (8 việc cũ): (a) tắt các routine cũ trước khi lên P0 — **khuyến nghị**, rồi gán lại qua vị trí nếu cần; hay (b) giữ và để bị chặn tan ca?
2. Việc **từ chối** ở vị trí `ACCEPT_OR_DECLINE`: quay về **người giao** để giao lại (khuyến nghị) hay tự chuyển người dự phòng (P1)?
3. ~~Mặc định chính sách~~ → **Đã chốt 08/10:** chính sách nhận việc là **nút cấu hình theo vị trí, admin chọn** (mục 6). Vị trí "Quầy hỗ trợ NH01" seed = Bắt buộc làm / Bắt buộc làm; admin đổi được.


---

## 14. Ghi chú bước 5 (09/10/2026)

- **Không thêm mục Sidebar / quyền mới**: menu "Giao Việc" (`support_tasks_admin`) đã mở trang tab `/admin/support/templates`. Tab "Nghiệm Thu" cũ → **"Cần tôi xử lý"**, thêm tab **"Vị trí & bộ việc"**. Hai trang riêng `/admin/support/reviews`, `/admin/support/positions` dùng cùng component. Lý do: thêm module vào `MODULES` = thêm quyền mới (vùng Mức 2 phân quyền) mà không cần thiết.
- API mới: `PATCH/GET /api/support/task-template-config` (cấu hình chi tiết việc mẫu), `POST /api/support/tasks/reassign` (giao lại việc bị từ chối). `rework-photo` nhận `kind=ref` → lưu ảnh mẫu ở `refs/`. `GET /api/support/positions` trả thêm `staff`, `categories` cho ô chọn. `reviewTasks` thêm `allSlots` (màn chi tiết nhân viên không khoanh theo ô → trả cả việc).
- "Giao việc nóng" ở `/admin/support/dashboard` trước đây gửi id giả tới endpoint bỏ qua chúng → nay dùng form giao việc đột xuất thật.
- `EmployeeDetail`: đọc việc qua `GET /api/support/tasks` (theo mã Staff, không theo Users.id); duyệt / trả lại / giao đột xuất / xoá đều qua API (xoá = huỷ mềm); thêm nút "Bỏ khỏi người này" (EXCLUDE).
- **Dời sang bước 7** (phải xong TRƯỚC khi siết RLS, nếu không sẽ gãy): form "Kho việc" (`SupportTemplates.logic.ts` `saveCategoryWithTemplates`) còn ghi thẳng `TaskCategories` / `TaskTemplates`; đánh dấu đã đọc `TaskNotifications` ở màn nhân viên; `app/support/dashboard/SupportDashboard.logic.ts` là code chết (trang đã redirect).

## 15. Ghi chú bước 6 (09/10/2026)

- Dữ liệu: `scripts/office/nh01_checklist.data.ts` (chép từ `NH01_Checklist_Tracker_v2.html`), chạy bằng `scripts/office/seed_nh01_checklist.ts` — mặc định chạy thử, `--apply` mới ghi, DB thật cần `--prod-approved`. Khớp theo tên nên chạy lại không trùng; việc mẫu admin đã cấu hình (có `photo_slots`) thì giữ nguyên.
- Kết quả: 7 nhóm việc ngày (theo khung giờ, tên `NH01 · n. …`) + 1 nhóm tuần; 43 việc ngày + 7 việc tuần (việc lặp nhiều thứ gộp 1 mẫu, `cron_schedule` liệt kê thứ). Mỗi ngày sinh 45 việc (khăn lau tay = 3 mốc 09:00/13:00/17:00 × 4 ô khu vực) + việc tuần: T2 3 · T3 3 · T4 1 · T5 0 · T6 2 · T7 0 · CN 1.
- Quyết định mặc định (admin sửa được trên màn hình):
  - Mọi việc **giờ tự do** (đúng ý "không ép giờ, miễn hoàn thành"); khung giờ chỉ dùng để xếp nhóm. Riêng khăn lau tay là 3 mốc.
  - **Việc ngày không tồn sang hôm sau** (`allow_carry_over=false`) vì hôm sau đã có bản mới — tồn sẽ thành 2 bản cùng việc. Việc tuần cho tồn.
  - Vị trí "Quầy hỗ trợ NH01": việc cố định **Bắt buộc làm**, đột xuất **Bắt buộc làm**; giờ ca để trống.
  - Ô ảnh: số ảnh = số khu vực → mỗi khu vực 1 ô; có nhãn rõ trong nội dung thì dùng nhãn đó; còn lại "<khu vực> · ảnh i". Ghế tròn: ô số lượng tối thiểu 5.
- TEST: đã seed (không có NH001 trên TEST → vị trí chưa có thành viên). Cron `/api/cron/generate-tasks` đã đăng ký từ bước 3 (`5 17 * * *` UTC = 00:05 VN).
- DB thật (cần duyệt riêng, sau migration): `seed … --apply --prod-approved --member=NH001 --deactivate-old-routines=<name|role|all>`.
  - Probe chỉ đọc 09/10: NH001 có **120 routine cũ đang bật**, chỉ **3** trùng đúng tên (lời văn cũ khác); 37 không gắn phòng (bản cũ của chính checklist NH01: "Trước 09:00", "Từ 09:00", "Bàn giao kết ca", "Định kỳ tuần") + **83 theo phòng** ("CÔNG VIỆC HẰNG NGÀY": giấy toilet, nước rửa tay, kính… từng phòng).
  - Chỉ tắt theo tên (`name`) → NH001 nhận cả ~45 việc mới lẫn ~117 việc cũ mỗi ngày (trùng ý). **User chốt 09/10/2026: `all`** — NH001 chỉ làm theo checklist của file artifact; tắt cả 120 routine cũ (không xoá).
- User chốt 09/10/2026: trước mắt chạy trên **Vercel Hobby + DB TEST** (nhánh `test/*` với `vercel.json` crons rỗng, không merge).

## 16. Môi trường thử (09/10/2026)

- Vercel Hobby `test-98d3c5e6/quan-tri-va-ktv`, nhánh `test/office-p0-hobby-20261009` (= `feat/office-p0-checklist-v1` + `vercel.json` crons rỗng, **không merge**). Link: https://quan-tri-va-ktv-git-test-office-p0-hobby-20261009-test-98d3c5e6.vercel.app (sau Vercel SSO).
- DB TEST: tạo tài khoản thử NH001 (Phát, TECHNICIAN, TYPE_A, giống DB thật, mật khẩu riêng cho TEST), bật `block_checkout_incomplete_tasks_TYPE_A=true` như DB thật, seed NH01 với thành viên NH001.
- ⚠️ Khi lên thật: DB thật NH001 có `Staff.feature_flags.enable_employee_tasks = false` → không thấy menu "Công việc của tôi" trong khi chấm công vẫn bị chặn. **Phải bật cờ này** cùng lúc seed (thêm vào checklist lên thật).
- Cập nhật nhánh test: commit trên `feat/office-p0-checklist-v1` rồi merge sang nhánh test và push nhánh test.

## 17. Bước 7 (09/10/2026, DB TEST)

- Probe chỉ đọc (TEST + DB thật): 8 bảng việc có policy **"Allow all access" cho public** → ai cầm khoá anon (có sẵn trong trang web) cũng thêm/sửa/xoá được việc, ảnh, kết quả duyệt.
- Migration `20261009150000_office_p0_task_rls_read_only.sql`: thay bằng `office_client_read_only` (chỉ SELECT cho anon + authenticated) — màn hình và realtime vẫn đọc được. **Đã apply TEST** (chạy 2 lần OK). DB thật: chưa.
- Trước khi siết, chuyển nốt ghi từ trình duyệt: form "Kho việc" → `POST /api/support/task-categories` (`saveCategoryWithTemplates`, việc bỏ khỏi danh sách = tắt, không xoá, không sửa được việc của nhóm khác); đánh dấu đã đọc thông báo → `POST /api/support/notifications` (có kiểm người).
- Thêm kiểm quyền: `GET/POST /api/support/notifications`, `GET /api/support/room-stats`, `GET /api/support/templates/available`.
- Xoá code chết: `app/api/support/tasks/[id]/{review,status,photos}` + `lib/support-task.service.ts` (route **không kiểm đăng nhập**, ghi bằng service role → RLS không chặn được), `app/api/support/tasks/rework` (xoá ảnh, đã thay bằng supersede), `app/support/dashboard/SupportDashboard.logic.ts`. Grep: không màn nào gọi; WebBooking / WRB nội bộ không dùng.
- Kiểm: QA29 dùng **khoá anon thật**: đọc được 8 bảng; không thêm/sửa/xoá được nhóm việc, việc, ảnh, kết quả duyệt; không đọc được bảng Office mới.
- ⚠️ Còn mở (không thuộc P0): `AUTH_ENFORCE_API` chưa bật ở đâu (cả Hobby) → API gọi **không có phiên** vẫn qua. RLS chặn ghi thẳng DB, nhưng API vẫn cần cờ này để chặn người chưa đăng nhập. Bucket Storage `task-photos` chưa siết.

## 18. Chỉnh UI sau khi user xem bản Hobby (09/10/2026)

- Nền trắng: `/support/tasks`, `/admin/support/{reviews,positions,templates}` (không đổi `AppLayout` chung).
- Tên nhóm bỏ tiền tố "NH01 · " (`1. …` → `7. …`, `8. Việc theo thứ trong tuần`); seed tự đổi tên nhóm cũ (giữ id, bộ việc, việc đã giao). TEST đã đổi.
- Trạng thái tách khỏi nhóm việc: chip **Trạng thái** sinh từ các trạng thái đang có (chấm màu như thẻ việc, lọc đúng 1 trạng thái); **Nhóm việc** là ô chọn trung tính có biểu tượng thư mục; tiêu đề nhóm dạng thư mục + số việc; thẻ trong nhóm không lặp tên nhóm.
- **Ảnh mẫu do giám sát đặt, 2 phía cùng thấy** (user chốt): ô trống hiện ảnh mẫu to + nút "Chụp giống mẫu", "Xem mẫu"; đã chụp thì mẫu thu về góc. Không có ảnh tự động thay thế. Đọc mẫu **hiện tại** của việc mẫu (`resolveSlotRefs`) nên đặt xong là việc đã giao hôm nay cũng thấy. Giám sát đặt mẫu ngay trên thẻ duyệt: "Đặt làm ảnh mẫu" (chép ảnh đạt sang `refs/`) hoặc "Tải ảnh mẫu"; API `POST /api/support/task-template-config/sample`.
