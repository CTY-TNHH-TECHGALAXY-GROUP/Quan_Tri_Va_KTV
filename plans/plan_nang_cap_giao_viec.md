# Plan — Nâng cấp module Giao việc (Hậu cần) theo mẫu checklist NH01

> ⚠️ **Đã được thay bằng `plans/plan_office_p0_nen_tang_checklist.md` (08/10/2026).** File này giữ làm lịch sử phân tích lỗi; quyết định ở mục 9 vẫn áp dụng.

> Mức 2 — chạm chấm công / chặn tan ca, phân quyền, migration DB, xoá dữ liệu.
> Trạng thái: **CHỜ DUYỆT**. Ngày lập: 08/10/2026. Nhánh: `feat/bit-lo-hong-phase1`.
> Nguồn giao diện mẫu: artifact NH01 build v3 (https://claude.ai/artifact/T8ktqjHxdDm61TvGPYvmLB).

---

## 0. Bối cảnh & số liệu thật

- Module đã chạy thật tháng 8: 3.495 việc, 2.586 hoàn thành, 705 duyệt, 3.083 ảnh (chủ yếu NH001).
- Tháng 9: 468 việc sinh ra, **0** hoàn thành. Lần hoàn thành cuối 27/08, duyệt cuối 16/08, sinh việc cuối 22/09.
- Lý do bỏ (user xác nhận 08/10): **giao diện bất tiện**.
- Hai app WebBooking / WRB nội bộ **không** dùng các bảng Task* (đã `git grep`).

## 1. Mục tiêu

1. Giao diện nhân viên + giám sát theo artifact NH01: thẻ việc có **ảnh mẫu cạnh ảnh nộp**, **ô ảnh có nhãn**, trạng thái tự tính, lịch sử vòng.
2. Thư viện việc → gán cho từng nhân viên (đã có) + **giao việc đột xuất** chạy được.
3. **Chế độ thời gian** cấu hình theo từng mẫu việc.
4. **Chặn tan ca khi còn việc chưa được duyệt** — đóng các lỗ hổng hiện tại.
5. Tối ưu logic: sinh việc chắc chắn, không trùng, không mất lịch sử ảnh, kiểm đủ ảnh ở server.

## 2. Lỗi logic hiện tại (sẽ sửa)

| # | Lỗi | Vị trí | Hậu quả |
|---|---|---|---|
| L1 | Việc chỉ sinh khi mở trang `/support/tasks` | `app/api/support/tasks/route.ts:22` | Không mở trang = không có việc = **không bị chặn tan ca** |
| L2 | Chặn tan ca chỉ xét việc `created_at` hôm nay | `attendance/route.ts:163-170` | Việc tồn hôm qua chưa duyệt không chặn |
| L3 | Query chặn bị **copy 4 nơi** | `attendance/route.ts`, `attendance/status/route.ts`, `on-call/route.ts:100`, `type-d/on-call/route.ts:102` | Vi phạm mục 4.2 — sửa 1 nơi lệch 3 nơi |
| L4 | Khoá chống trùng chỉ trong RAM 1 instance | `employeeTasks.service.ts:65-76` | Fluid Compute nhiều instance → sinh trùng việc |
| L5 | `todayStr` lấy theo giờ server (UTC) | `employeeTasks.service.ts:83` | 00:00–07:00 VN kiểm nghỉ phép/vắng **sai ngày** |
| L6 | `min_photo_count` chỉ kiểm ở client | `route.ts:48` POST COMPLETE | Gọi API trực tiếp là hoàn thành không cần ảnh |
| L7 | GET/POST `/api/support/tasks` không xác thực | `route.ts:7,34` | Ai cũng đổi trạng thái việc người khác |
| L8 | Yêu cầu làm lại **xoá hết ảnh cũ** (DB + storage) | `tasks/rework/route.ts` | Mất bằng chứng, mất lịch sử vòng |
| L9 | `reviewer_id: null` (TODO) | `EmployeeDetail.logic.ts:~608` | Không biết ai duyệt |
| L10 | "Giao việc nóng" gọi API sai payload | `admin/support/dashboard/SupportDashboard.logic.ts:56` | Nút hỏng |
| L11 | `/support/dashboard` (trang mặc định role SUPPORT) gọi bảng đã xoá | `app/support/dashboard/SupportDashboard.logic.ts:36,63,90` | Trang hỏng |
| L12 | Sinh việc **xoá** việc "stale" mỗi lần mở trang | `employeeTasks.service.ts:153-211, 252-270` | Xoá dữ liệu ngầm trên đường nóng |
| L13 | Code chết tham chiếu bảng đã DROP | `SupportTasksAdmin.logic.ts`, `api/support/templates`, `areas`, `tasks/[id]/photos`, `tasks/[id]/status` | Rác, dễ gọi nhầm |

## 3. Thiết kế

### 3.1. DB (migration mới — cập nhật `TableInSupabase.md` cùng commit)

Chỉ **thêm cột / bảng**, không đổi tên, không xoá cột (an toàn với code đang chạy trên `main`).

`TaskTemplates` thêm:
- `photo_slots jsonb` — mảng nhãn ô ảnh, VD `["Phòng gội","Sảnh"]`. Null → dùng `min_photo_count` ô không nhãn.
- `time_mode text` — `FREE` | `DEADLINE` | `WINDOW` | `MULTI` (default `FREE`).
- `due_time text` ("HH:mm"), `window_start text`, `window_end text`, `multi_times jsonb` (["09:00","13:00","17:00"]).
- `requires_review boolean default true`, `blocks_checkout boolean default true`, `allow_carry_over boolean default true`.
- `reference_photos jsonb` — ảnh mẫu theo từng ô (storage path).

`Tasks` thêm:
- `task_date date` — **ngày nghiệp vụ VN** (thay cho suy từ `created_at`).
- `slot_time text` — mốc cho chế độ `MULTI` (mỗi mốc 1 task).
- `photo_slots jsonb`, `time_mode`, `due_at` (đã có), `window_start_at`, `window_end_at` — snapshot từ mẫu lúc sinh.
- `requires_review`, `blocks_checkout` — snapshot.
- `assigned_by text`, `reviewed_by text`, `reviewed_at timestamptz`.
- Unique index `(assignee_id, template_id, coalesce(room_id,''), task_date, coalesce(slot_time,''))` where `task_type='FIXED'` → **chống sinh trùng ở DB** (thay khoá RAM).

`TaskPhotos` thêm:
- `slot_index int`, `superseded_at timestamptz` — làm lại thì đánh dấu ảnh cũ là cũ, **không xoá**.

Backfill: `Tasks.task_date = (created_at at time zone 'Asia/Ho_Chi_Minh')::date`.

### 3.2. Logic (gom về `lib/services/employeeTasks.service.ts`)

- `ensureTasksForDate(staffId, date)` — idempotent nhờ unique index (`insert … on conflict do nothing`). Gọi ở **3 chỗ**: mở trang, **CHECK_IN**, và **ngay trước khi kiểm chặn tan ca** → đóng L1 mà không cần cron (cron trên phase1 chưa chạy vì production = main).
- **Bỏ xoá "stale"** khi sinh việc (L12): việc của mẫu bị gỡ thì **không sinh nữa**; việc đã sinh giữ nguyên, admin xoá tay nếu cần.
- `getCheckoutBlockers(staffId)` — **một nguồn duy nhất** cho 4 route (L3). Điều kiện:
  - `blocks_checkout = true`
  - `task_date = hôm nay` **hoặc** việc tồn (`task_date < hôm nay`, chưa PASSED, `allow_carry_over`)
  - trạng thái chưa `PASSED` (gồm chưa làm, đang làm, chờ duyệt, bị trả lại)
  - Trả `{ count, items[{id,name,state}] }` để màn chấm công hiện **danh sách cụ thể**.
- `submitTask(taskId, staffId)` — server kiểm **đủ ảnh theo từng ô** (L6), kiểm cửa sổ giờ nếu `WINDOW`, đánh dấu trễ nếu `DEADLINE` quá hạn (không chặn).
- `reviewTask(taskId, reviewerId, decision, note, photo, slotIndexes?)` — ghi `TaskReviews` + `reviewed_by` (L9); `REWORK` chỉ đánh `superseded_at` cho **ô bị chê** (L8).
- `assignAdhoc({assigneeId, templateId|name, photoSlots, dueAt, blocksCheckout})` — sửa L10, có thông báo `TaskNotifications` NEW_TASK.
- Ngày VN dùng helper sẵn có (không `new Date().toLocaleDateString`) — sửa L5.

### 3.3. Quyền (L7)

- GET/POST `/api/support/tasks`: `requireStaffOrPermission(employeeId, 'support_tasks_admin')`.
- Duyệt / giao đột xuất / sửa thư viện / ảnh mẫu: `requirePermission('support_tasks_admin')`.
- Nhân viên **không** có nút đổi vai, không sửa ảnh mẫu.

### 3.4. Giao diện (theo artifact)

**Nhân viên — `app/support/tasks`** (viết lại UI, giữ route):
- Thanh tóm tắt: Chưa làm / Đang làm / Chờ duyệt / Bị trả lại / Đã duyệt.
- Nhóm theo danh mục, thu gọn được; lọc "Chưa xong"; việc **đột xuất** và **việc tồn** lên đầu.
- Thẻ việc: ảnh mẫu ↔ ô ảnh nộp **theo từng nhãn**; nút chụp (camera) cỡ ≥ 44px; trạng thái tự tính, **không tick tay**; hiện hạn / khung giờ nếu có; lý do trả lại + ảnh lỗi; lịch sử vòng.
- Banner chặn tan ca: "Còn N việc chưa được duyệt" + danh sách.

**Giám sát — `app/admin/support/employee/[id]` + hàng chờ `reviews`**:
- Hàng chờ duyệt dạng lưới: ảnh nộp cạnh ảnh mẫu, duyệt từng việc / hàng loạt, trả lại chọn ô + lý do chọn sẵn.
- Nút "Giao việc đột xuất".
- Tổng quan hôm nay theo từng nhân viên: tiến độ, việc tồn, việc chặn tan ca.

**Thư viện — `app/admin/support/templates`**: thêm cấu hình ô ảnh có nhãn, ảnh mẫu từng ô, chế độ thời gian, cờ duyệt / chặn tan ca / cho tồn.

**`app/support/dashboard`** (L11): chuyển hướng sang `/support/tasks`.

Chữ hiển thị tách ra `*.i18n.ts` (mục 6).

### 3.5. Dọn code chết (L13)

Xoá: `app/admin/support-tasks/*`, `api/support/templates/route.ts`, `api/support/areas/route.ts`, `api/support/tasks/[id]/photos`, `api/support/tasks/[id]/status`, `lib/support-task.service.ts` (sau khi chuyển hàm kiểm ảnh sang service chính). Grep lại trước khi xoá.

## 4. Bảng ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV / nhân viên | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn / API | `/support/tasks`, `/ktv/attendance` (banner chặn), `/api/ktv/attendance`, `/api/ktv/attendance/status`, `/api/ktv/on-call`, `/api/ktv/type-d/on-call` | `/admin/support/templates`, `employee/[id]`, `reviews`, `dashboard` | `employeeTasks.service.ts`, Task* tables, `SystemConfigs.block_checkout_incomplete_tasks_*` | **Sửa** |
| Số liệu | Số việc chặn tan ca, tiến độ cá nhân | Tiến độ theo nhân viên, hàng chờ duyệt | `getCheckoutBlockers` + trạng thái tự tính trong service | **Khớp** — một nguồn |
| Realtime | `TaskNotifications` (đã có) | Thêm subscribe `Tasks`/`TaskPhotos` cho hàng chờ duyệt | Bảng Tasks, TaskPhotos | **Cần thêm** phía quản lý |
| Quyền | Chỉ thấy việc của mình, không duyệt, không sửa mẫu | `support_tasks_admin` | `auth-server.ts` (không sửa) | Không lộ dữ liệu |
| Tiền / tua / giờ | Không ảnh hưởng — module không ghi ledger nào | Không ảnh hưởng | — | Không ảnh hưởng |

## 5. Vùng nổ (mục 4.5)

1. **Dùng chung gì?** Route chấm công `CHECK_OUT` và tắt on-call của **mọi KTV** có cấu hình chặn bật (hiện chỉ `TYPE_A = true`). Đây là **đường nóng**.
2. **Nếu sai thì sập gì?**
   - Lỗi trong `getCheckoutBlockers` → KTV TYPE_A **không tan ca được**.
   - **Biện pháp:** bọc try/catch — lỗi thì **cho tan ca** + log (fail-open), không chặn nhầm. Lỗi `ensureTasksForDate` ở CHECK_IN **không được** làm hỏng check-in (bọc try/catch, chạy sau khi ghi chấm công).
   - Bật chặn khi thiếu người duyệt cuối ca → nhân viên kẹt. **Biện pháp:** giám sát có nút "Cho tan ca" (ghi lý do, lưu `SecurityEvents`/log), xem mục 8 câu hỏi 2.
3. **Luồng khách?** Không — module chỉ nội bộ, WebBooking / WRB không đọc bảng Task* (đã grep).
4. **Cô lập?** Mọi logic mới nằm trong service; route chấm công chỉ gọi 1 hàm, không thêm cột vào select chính của chấm công.

**Cột mới chưa có trên DB thật → coi như không tồn tại.** Code đọc cột mới phải đợi migration được apply; thứ tự triển khai ở mục 7.

## 6. Ảnh hưởng vận hành (sẽ trình lại trước commit — mục 5.1)

- **Nhân viên TYPE_A (NH001…)**: giao diện mới; việc tự sinh khi check-in; **không tan ca được nếu còn việc chưa duyệt — kể cả việc tồn hôm qua** (chặt hơn hôm nay).
- **Giám sát**: phải duyệt trước giờ tan ca của nhân viên, nếu không nhân viên kẹt.
- Cần báo trước cho quầy + nhân viên 1 ngày, và có người duyệt trực cuối ca.

## 7. Thứ tự triển khai (mỗi bước 1 commit, chạy được độc lập)

1. **Migration** (thêm cột, unique index, backfill `task_date`) → probe DB thật xác nhận.
2. **Service + quyền**: `ensureTasksForDate`, `getCheckoutBlockers`, `submitTask`, `reviewTask`, `assignAdhoc`; vá L5–L9, L12; 4 route chặn gọi chung `getCheckoutBlockers`.
3. **UI nhân viên** `/support/tasks` theo artifact + redirect `/support/dashboard`.
4. **UI giám sát**: hàng chờ duyệt, giao đột xuất, tổng quan.
5. **Thư viện**: ô ảnh có nhãn, ảnh mẫu, chế độ thời gian.
6. **Nhập checklist NH01** (43 ngày + 13 tuần) vào thư viện bằng script (chạy TEST DB trước).
7. Dọn code chết (L13).

## 8. Kiểm thử (mục 10)

Script `scripts/qa/qa_25_giao_viec.ts` trên **TEST DB**, chạy thêm `TZ=UTC`:
- Sinh việc gọi song song 5 lần → không trùng.
- 00:30 VN: ngày nghiệp vụ đúng, kiểm nghỉ phép đúng ngày.
- Nộp thiếu ảnh 1 ô → server từ chối.
- Trả lại 1 ô → ảnh ô khác giữ nguyên, ảnh cũ còn trong lịch sử.
- Chặn tan ca: việc hôm nay chưa duyệt / việc tồn hôm qua / việc `blocks_checkout=false` / service lỗi → fail-open.
- Không mở trang mà check-in rồi checkout → vẫn bị chặn (L1).
- `MULTI` 09/13/17 → 3 task; `WINDOW` ngoài khung → không nộp được.
- Báo off đột xuất (`SUDDEN_OFF_CHECKOUT`) — theo quyết định câu hỏi 1.

## 9. Đã chốt (user, 08/10/2026)

1. Báo off đột xuất → **miễn chặn**.
2. Giám sát có nút **"Cho tan ca"** kèm lý do, ghi log.
3. Việc tồn hôm qua **có** chặn tan ca hôm nay.
4. **Bỏ** tự xoá việc stale.

### Câu hỏi gốc

1. **Báo off đột xuất** hiện **cũng bị chặn** bởi việc chưa duyệt (`attendance/route.ts:146`). Giữ hay miễn? → Khuyến nghị **miễn** (người nghỉ đột xuất không thể chờ duyệt).
2. **Cuối ca không có người duyệt** → khuyến nghị giám sát có nút "Cho tan ca" kèm lý do (ghi log). Đồng ý?
3. **Việc tồn** có chặn tan ca ngày hôm sau không? → Khuyến nghị **có** (đúng tinh thần "đủ trách nhiệm"), giới hạn tồn 1 ngày như hiện tại.
4. Bỏ cơ chế **tự xoá việc stale** (L12) — đồng ý?
