# Prompt — Bịt lỗ hổng vận hành (v16 Phần 4), Phase 1

> Copy toàn bộ phần dưới gửi cho anti.
> Kế hoạch chi tiết: `plans/plan_bit_lo_hong_van_hanh_v16_phase1.md` (đọc trước khi code).
> Nguồn nghiệp vụ gốc: `E:\Oria\Chinh sach moi type D\v16.md` — PHẦN 4 và PHẦN 5/Phase 1.

---

## 0. ⚠️ ĐỌC MỤC NÀY TRƯỚC — đang có nhiều luồng chạy song song trên cùng repo

Repo này **đang có ít nhất 2 luồng khác chạy đồng thời** với luồng của bạn. Không được coi cây thư mục là của riêng mình.

| Luồng | Ai đang làm | File họ đang giữ | Bạn được phép đụng? |
|---|---|---|---|
| **TYPE_D Phase 5** (Admin UI tab "Loại D") | Đang chạy live, xem `plans/prompt_type_d_sua_phase5_v2.md` | `app/admin/settings/system/page.tsx`, các key `ktv_type_d_*` trong `SystemConfigs`, `plans/plan_che_do_type_d.md` | ❌ **TUYỆT ĐỐI KHÔNG** |
| **TYPE_D rollout Bước B→E** | Xem `plans/prompt_type_d_rollout_full.md` §3 | `lib/services/KtvLedgerSyncService.ts`, `app/api/cron/sync-daily-ledger/route.ts`, `app/reception/dispatch/_components/QuickDispatchTable.tsx`, `app/ktv/` (màn ví, Heo đất, giờ tích lũy), `app/api/ktv/attendance/route.ts:~488` (phí giặt đồ) | ❌ Không, trừ vùng đã nêu ở §3 |
| **Phase 1 này** | Bạn | Xem bảng §1 | ✅ |

### Luật chống xung đột — bắt buộc

1. **Làm trên nhánh riêng**, không code thẳng `main`:
   `git checkout -b feat/bit-lo-hong-phase1`
2. **Không commit hộ file của người khác.** `git status` hiện đang có sẵn nhiều file rác đang chờ xoá (`check_db.js`, `force_fix_tsc.js`, `force_fix_tsc_2.js`, `scratch_check_nh011_today.ts`) và nhiều file `plans/*`, `scripts/*` untracked — **của luồng khác**. Chỉ `git add` đúng các file bạn tự tạo/sửa, liệt kê tường minh từng đường dẫn. **Cấm `git add -A` / `git add .`**
3. **File dùng chung `app/api/ktv/attendance/route.ts`**: luồng TYPE_D đang sửa quanh **dòng ~488** (phí giặt đồ). Bạn chỉ được chèn vào **khối `checkType === 'CHECK_OUT'` ở dòng 119-153**. Không format lại file, không đụng dòng nào ngoài khối đó, không đổi import order.
4. **`SystemConfigs` là bảng dùng chung, đang bị luồng khác ghi cùng lúc.** Mọi thao tác phải là `INSERT ... ON CONFLICT (key) DO UPDATE` cho **đúng key của bạn**. Cấm `DELETE`, cấm ghi đè cả bảng, cấm đụng bất kỳ key `ktv_type_d_*` nào.
5. **Key `notification_rules` là MỘT dòng JSON chứa toàn bộ rule của hệ thống.** Bắt buộc **đọc → merge thêm entry `GUEST_ARRIVAL` → ghi lại**. Nếu ghi đè cả object là xoá sạch rule của mọi loại thông báo khác. Ưu tiên dùng `PATCH /api/admin/notification-rules` (route đã tự merge) thay vì `UPDATE` thẳng DB.
6. **Migration**: file mới nhất hiện tại là `20260901170000_*`. Đặt tên bắt đầu từ `20260902090000_` trở đi để không đụng số. Trước khi tạo, `ls supabase/migrations | tail -5` xem có ai vừa thêm file mới không.
7. Trước khi bắt đầu **và** trước khi commit: chạy `git pull --rebase` rồi `git status`. Nếu thấy file trong bảng §1 của bạn đã bị người khác sửa → **dừng lại, báo cáo, đừng tự merge**.

---

## 1. Phạm vi Phase 1 — chỉ 3 hạng mục, không hơn

| Hạng mục | Nội dung | File bạn được sửa |
|---|---|---|
| **A** | Lễ tân bấm [Thông báo có khách] → khóa nút [Tan ca] của KTV | `supabase/migrations/20260902090000_*.sql` [NEW], `app/api/reception/guest-arrival/route.ts` [NEW], `app/reception/dispatch/page.tsx`, `app/api/notifications/trigger-webhook/route.ts`, `app/api/ktv/attendance/status/route.ts`, `app/api/ktv/attendance/route.ts` (chỉ khối 119-153), `app/ktv/attendance/Attendance.logic.ts`, `app/ktv/attendance/page.tsx`, `app/ktv/attendance/_components/AttendanceTypeB.tsx` |
| **B** | App KTV tự đá văng Đơn Cha `SPLIT` | `app/api/ktv/booking/_handlers/handleGetBooking.ts`, `app/ktv/dashboard/KTVDashboard.logic.ts` (chỉ handler realtime dòng ~1091-1112) |
| **C** | Test hồi quy chống kẹt luồng (race condition) | `scripts/test_race_condition_handover.ts` [NEW], `package.json` (chỉ thêm 1 dòng script) |

### KHÔNG làm trong đợt này
- ❌ Mục 4.4 (đổi KTV giữa chừng → `CANCEL`) — Phase 2, thiết kế đang chờ chủ dự án chốt.
- ❌ Mục 4.5 (nút [Hủy tua] + badge cảnh báo) — Phase 2.
- ❌ Thuế TNCN 10% — thuộc Phần 1 của v16, chưa chốt có gộp đợt này không (§6 câu 4).
- ❌ Bất kỳ refactor "tiện tay" nào. Thấy code xấu thì ghi vào báo cáo, không sửa.

---

## 2. HẠNG MỤC A — Khóa nút [Tan ca] khi có khách

### Nguyên tắc thiết kế (đã chốt, không tự đổi)

Khóa là **một bản ghi có hạn dùng (TTL)**, **không phải cờ boolean toàn cục**. Lý do: cờ boolean mà lễ tân quên tắt là KTV kẹt cả đêm không tan ca được — đây là lỗi vận hành nặng hơn cả lỗ hổng đang vá.

### A1. Migration `[NEW] supabase/migrations/20260902090000_create_guest_arrival_events.sql`

Bảng `GuestArrivalEvents`: `id uuid pk default gen_random_uuid()`, `created_by text`, `created_at timestamptz default now()`, `expires_at timestamptz not null`, `released_at timestamptz null`, `note text`. Index trên `(released_at, expires_at)`.

Khóa đang hiệu lực ⟺ `released_at IS NULL AND now() < expires_at`.

Thêm vào realtime — **bọc kiểm tra tồn tại**, copy đúng khuôn mẫu `supabase/migrations/20260818_create_booking_guests.sql:38-42` (nếu `ALTER PUBLICATION` chạy 2 lần trên bảng đã có sẽ lỗi):

Seed 3 config bằng `INSERT ... ON CONFLICT DO UPDATE` theo mẫu `supabase/migrations/20260502000000_add_day_cutoff_config.sql`:
- `guest_arrival_lock_enabled` = `true`
- `guest_arrival_lock_minutes` = `10`
- `guest_arrival_lock_TYPE_D` = `true`

> ⚠️ **Bẫy đặt tên key**: trang Admin `app/admin/settings/system/page.tsx` **tự ghép hậu tố** `_${activeTab}` vào key khi đọc/lưu (xem `plans/prompt_type_d_phase5.md`). Nên key gốc phải là `guest_arrival_lock`, biến thể theo loại KTV là `guest_arrival_lock_TYPE_D`. Đặt sai kiểu (VD `type_d_guest_arrival_lock`) là sau này tab Admin không đọc được.

### A2. `[NEW] app/api/reception/guest-arrival/route.ts`

- `POST` — `requirePermission('dispatch_board')`; đọc `guest_arrival_lock_minutes`; insert 1 event `expires_at = now() + N phút`; gọi `createNotification({ type: 'GUEST_ARRIVAL', message: 'Có khách vào — tất cả KTV giữ máy, chưa được tan ca.' })` từ `lib/notification-helper.ts`.
- `DELETE` — set `released_at = now()` cho mọi event đang mở.
- `GET` — trả trạng thái khóa hiện tại cho UI lễ tân.

> ⚠️ **Không tự gửi Push trong route này.** `lib/notification-helper.ts:1-12` đã ghi rõ: chỉ INSERT vào `StaffNotifications`, Push do DB Webhook → `trigger-webhook` lo. Gửi thêm ở đây là KTV nhận đúp 2 lần.

### A3. `[MODIFY] app/api/notifications/trigger-webhook/route.ts`

Thêm nhánh title cho `record.type === 'GUEST_ARRIVAL'`: title `🔔 CÓ KHÁCH`, `requireOnShift: true`. Chỉ đụng phần dựng title/message ở khối `ktvRoles` (dòng ~113-126), không đổi cấu trúc rule.

### A4. Rule thông báo

Thêm entry vào `SystemConfigs.notification_rules` qua `PATCH /api/admin/notification-rules`:

`"GUEST_ARRIVAL": { "enabled": true, "allowed_roles": ["KTV","ADMIN","RECEPTION"], "include_target_employee": false, "require_on_shift": true }`

Xem lại luật §0.5 trước khi ghi.

### A5. `[MODIFY] app/api/ktv/attendance/status/route.ts`

Trả thêm `guestArrivalLock: { active, until, message }`.

> ⚠️ **Bẫy**: route này có **8 nhánh `return NextResponse.json`** (dòng 134-185). Thiếu 1 nhánh là UI mất khóa ở đúng trạng thái đó. Làm y hệt cách `incompleteTasksCount` đang được truyền — grep `incompleteTasksCount` trong file, có bao nhiêu chỗ thì thêm đủ bấy nhiêu.

### A6. `[MODIFY] app/api/ktv/attendance/route.ts` — chặn cứng backend

Chèn vào **cuối khối `if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT')` (dòng 119-153)**, ngay sau đoạn check task chưa nghiệm thu. Dùng lại đúng khuôn mẫu đọc config theo `work_type` đã có ở dòng 131.

- Khóa bật + config theo `work_type` bật → trả **403**: `"Quầy vừa báo có khách. Vui lòng giữ máy, chưa thể tan ca lúc này."`
- **Không chặn** `checkType === 'SUDDEN_OFF'` và `OFF_REQUEST` (nghỉ nguyên ngày / xin OFF) — chỉ chặn tan ca giữa & cuối ca.

> ⚠️ Nhắc lại §0.3: đây là file luồng TYPE_D đang giữ ở dòng ~488. Không đụng ra ngoài khối 119-153.

### A7. `[MODIFY] app/ktv/attendance/Attendance.logic.ts`

- State `guestArrivalLock`, đọc từ API status (cạnh `incompleteTasksCount`, dòng ~96).
- `useEffect` subscribe realtime `postgres_changes` `event: '*'` bảng `GuestArrivalEvents` — copy khuôn mẫu subscription sẵn có ở dòng 186-210 (nhớ `supabase.removeChannel` trong cleanup).
- Thêm `setTimeout` tự mở khóa đúng mốc `until`. **Không phụ thuộc hoàn toàn vào realtime** — mất mạng 5 giây là KTV kẹt vĩnh viễn.
- Export `guestArrivalLock` trong return object (dòng ~370-400).

### A8. `[MODIFY] app/ktv/attendance/page.tsx`

- Thêm `guestArrivalLock.active` vào `disabled` của nút Tan ca (dòng 619) và vào nhánh đổi màu/label (dòng 621-627): label `"CÓ KHÁCH — GIỮ MÁY"`.
- Banner đỏ + đếm ngược, đặt cùng chỗ banner `incompleteTasksCount` (dòng 580-593).

### A9. `[MODIFY] app/ktv/attendance/_components/AttendanceTypeB.tsx`

Nhận prop `guestArrivalLock`, disable nút Check-out tương ứng. Bỏ qua file này là KTV Type B lách được qua UI khác.

### A10. `[MODIFY] app/reception/dispatch/page.tsx` — nút bấm cho lễ tân

Thêm nút **[🔔 Thông báo có khách]** vào cụm toolbar cạnh nút chuông (khu vực dòng ~1800-1865). Hai trạng thái: bình thường → bấm để báo (có `confirm` chống bấm nhầm); đang khóa → nút đỏ + đếm ngược `mm:ss`, bấm lần 2 = **[Đã xử lý xong]** nhả khóa sớm.

> ⚠️ File này 3887 dòng và luồng TYPE_D Bước D sắp đụng nhóm dispatch. Chỉ thêm nút vào toolbar, **không đụng `QuickDispatchTable.tsx`**, không sửa logic điều phối.

---

## 3. HẠNG MỤC B — App KTV đá văng Đơn Cha `SPLIT`

### Bối cảnh — đọc kỹ, lỗ hổng rộng hơn tưởng

RPC tách đơn `supabase/migrations/20260821165237_update_rpc_split_booking_vat.sql` làm đúng 2 việc:
- dòng 76-77: `UPDATE "BookingItems" SET "bookingId" = v_new_booking_id` → items **chuyển hết sang đơn con**
- dòng 136: `SET "status" = 'SPLIT'` → **đơn cha thành rỗng, không còn item nào**

`grep -n "TurnQueue\|KtvAssignments\|TurnLedger"` trong RPC này ra **0 kết quả** → RPC **không remap** ba bảng đó. Nên sau khi tách một đơn **đã điều phối**, có **HAI** bảng cùng trỏ sai vào đơn cha rỗng:

| Bảng | Trạng thái sau khi tách | Nơi bị ảnh hưởng |
|---|---|---|
| `TurnQueue.current_order_id` | vẫn = mã đơn **cha** | `handleGetBooking.ts:98-112` (nhánh 1.b resolve bookingId) |
| `KtvAssignments.booking_id` | vẫn = mã đơn **cha**, status `QUEUED`/`READY` | `handleGetBooking.ts:118-175` (khối AUTO-ACTIVATE ASSIGNMENT tra theo `booking_id`) |

⚠️ **Vá mỗi `TurnQueue` là chưa đủ** — khối auto-activate vẫn sẽ kích hoạt assignment trên đơn cha rỗng.

**Đường thoát duy nhất đang có sẵn**: nếu KTV **đã bấm bắt đầu** trước khi tách thì item `IN_PROGRESS` đã mang `bookingId` của đơn con → nhánh 1.a (dòng 60-86) tự khỏi. Ca kẹt thật là: **điều phối xong, KTV chưa bấm bắt đầu, lễ tân tách đơn**.

Commit `328eeee` (mới nhất, "gui dieu phoi vao dung don con sau khi tach don") chỉ vá **phía lễ tân** — `app/reception/dispatch/page.tsx`. Đã kiểm toàn bộ 19 commit về split/tách đơn: **không commit nào đụng `app/ktv/*` hay `app/api/ktv/*`**. `grep -rn "SPLIT\|parent_booking_id\|parentBooking" app/ktv app/api/ktv` tại HEAD ra **0 kết quả**. Đây là việc chưa ai làm.

### B1. `[MODIFY] app/api/ktv/booking/_handlers/handleGetBooking.ts`

**Lớp 1 — lọc.** Ba chỗ đang lọc `.not('status','in','("COMPLETED","CANCELLED")')` tại **dòng 104, 268, 538** → đổi thành `("COMPLETED","CANCELLED","SPLIT")`.

**Lớp 2 — remap.** Thêm khối `SPLIT_GUARD` **sau dòng 113** (kết thúc RESOLVE BOOKING ID, **trước** khối AUTO-ACTIVATE ASSIGNMENT — thứ tự này bắt buộc, đặt sau là assignment đã kịp active trên đơn cha). Nếu booking vừa resolve có `status='SPLIT'`:

1. **Tìm đơn con của chính KTV này**: `Bookings.parent_booking_id = <mã cha>`, có `BookingItems.technicianCodes` chứa `techCode`, status chưa `DONE/CANCELLED`.
2. **Có đơn con** → chuyển hướng sang đơn con, đồng thời dọn **cả hai** bảng lệch:
   - `TurnQueue.current_order_id` → mã đơn con (kèm `booking_item_id` / `booking_item_ids` tương ứng)
   - `KtvAssignments` của KTV này đang trỏ đơn cha (`status IN ('QUEUED','READY','ACTIVE')`) → cập nhật `booking_id` sang đơn con. Chỉ đụng assignment của **đúng `employee_id` + `business_date`** hiện tại, không đụng KTV khác.
3. **Không có đơn con** → đá văng:
   - `TurnQueue` → `current_order_id = null, booking_item_id = null, booking_item_ids = [], status = 'waiting'`
   - `KtvAssignments` đang trỏ đơn cha → `status = 'CANCELLED'` (đơn cha không còn tồn tại về mặt nghiệp vụ, để `QUEUED` là kẹt vĩnh viễn)
   - `return NextResponse.json({ success: true, data: null })`

**Lớp 3 — log.** `console.warn('🚫 [KTV] Đơn cha SPLIT: <mã cha> → <mã con | đá văng>')`.

> ⛔ **KHÔNG sửa RPC tách đơn** để nó tự remap `TurnQueue`/`KtvAssignments`. Đó là vùng của luồng dispatch, sửa RPC dùng chung giữa lúc nhiều luồng chạy song song là rủi ro không đáng. Phase 1 chỉ tự chữa ở phía App KTV. Nếu bạn cho rằng phải sửa tận gốc ở RPC thì **báo cáo, đừng tự làm**.

### B2. `[MODIFY] app/ktv/dashboard/KTVDashboard.logic.ts`

Trong handler realtime `Bookings` UPDATE (dòng ~1091-1112): xử lý `payload.new.status === 'SPLIT'` giống hệt nhánh `CANCELLED` — về `DASHBOARD`, dọn `localStorage`.

> ⚠️ **Giữ nguyên rào chắn hiện có**: nếu `screenRef.current` đang là `REVIEW / HANDOVER / REWARD` thì **không** đá văng. Phá rào này là KTV mất màn hình bàn giao giữa chừng, mất ảnh, mất tua.

---

## 4. HẠNG MỤC C — Test hồi quy race condition

**Code hiện tại ĐÃ ĐẠT yêu cầu 4.2. Không sửa logic. Chỉ viết test để khóa lại.**

Bằng chứng đã kiểm: `handleFinishService.ts:224-231` có chốt `item.status === 'DONE' ? 'DONE' : ...`; `app/api/ktv/booking/route.ts:146-176` có Safety Recompute; `lib/services/HandoverService.ts:168-184` ghi `handover_images` không phụ thuộc status Booking.

`[NEW] scripts/test_race_condition_handover.ts` — khuôn mẫu `scripts/simulate_type_d_*.ts`, chạy trên **đơn TEST**, 3 kịch bản:
1. Lễ tân set `DONE` trước → KTV `PATCH /api/ktv/booking { status:'FEEDBACK', action:'RELEASE_KTV', photosBase64 }` → kỳ vọng HTTP 200, `handover_images` được ghi, item vẫn `DONE`.
2. Khách rate trước, KTV chưa bàn giao → item phải `CLEANING` (không nhảy thẳng `DONE`).
3. Hai KTV cùng đơn bấm xong gần đồng thời → booking không bị đẩy `DONE` khi còn item `IN_PROGRESS`.

`[MODIFY] package.json` — thêm `"test:race"`, đặt cạnh `test:type-d`. **Chỉ thêm 1 dòng**, không đụng dependencies (file này luồng khác cũng có thể sửa).

---

## 5. Nghiệm thu — dán bằng chứng thật, không mô tả suông

- [ ] `npx tsc --noEmit` sạch
- [ ] `npm run test:type-d` vẫn xanh (chứng minh không phá luồng TYPE_D đang chạy song song)
- [ ] `npm run test:race` xanh, dán output
- [ ] **A**: lễ tân bấm nút → App KTV mờ nút Tan ca trong ≤3s (kèm ảnh chụp hoặc log realtime)
- [ ] **A**: KTV F5 lại app → nút vẫn mờ (chứng minh state đến từ API, không chỉ realtime)
- [ ] **A**: gọi thẳng `POST /api/ktv/attendance` `checkType='CHECK_OUT'` bằng curl → **403**, dán response
- [ ] **A**: hết TTL → nút tự mở lại, không ai thao tác
- [ ] **A**: `guest_arrival_lock_enabled = false` → bấm nút chỉ gửi thông báo, không khóa
- [ ] **A**: `SELECT key FROM "SystemConfigs" WHERE key LIKE 'ktv_type_d%'` — đếm số dòng **trước và sau** khi chạy migration, phải **bằng nhau** (chứng minh không giẫm lên luồng TYPE_D)
- [ ] **A**: `notification_rules` sau khi sửa vẫn còn **đủ** các rule cũ + 1 rule mới — dán danh sách key trước/sau
- [ ] **B**: kịch bản kẹt thật — điều phối đơn xong, **KTV chưa bấm bắt đầu**, lễ tân tách đơn → app nhảy đúng đơn con, không treo màn trắng
- [ ] **B**: sau kịch bản trên, dán kết quả 2 câu SQL chứng minh **cả hai** bảng đã hết trỏ vào đơn cha:
  `SELECT current_order_id FROM "TurnQueue" WHERE employee_id='<mã KTV>' AND date='<ngày>';`
  `SELECT booking_id, status FROM "KtvAssignments" WHERE employee_id='<mã KTV>' AND business_date='<ngày>';`
- [ ] **B**: tách đơn mà KTV không thuộc đơn con nào → app về Dashboard, `TurnQueue` sạch, `KtvAssignments` về `CANCELLED`, không treo trắng
- [ ] **B**: `GET /api/ktv/booking?bookingId=<mã đơn cha SPLIT>` → `data: null`, dán response
- [ ] **B**: KTV **đã bấm bắt đầu** rồi mới bị tách đơn → vẫn chạy bình thường qua nhánh 1.a, không bị guard mới đá nhầm
- [ ] **B**: KTV đang ở màn `HANDOVER` mà đơn bị tách → **không** bị đá ra
- [ ] `git diff --stat` cuối cùng chỉ chứa đúng các file ở bảng §1, không dư file nào

---

## 6. Commit & báo cáo

- Nhánh riêng `feat/bit-lo-hong-phase1`, **không** code thẳng `main`.
- Commit theo hạng mục (A / B / C tách riêng), message tiếng Việt **không dấu**, prefix `feat(ops):` — cố ý khác `feat(type-d):` của luồng kia để đọc log phân biệt được.
- `git add` liệt kê tường minh từng file. **Cấm `git add -A` / `git add .`**
- Báo cáo cuối phải nêu: đã làm hạng mục nào, file nào đụng vào, kết quả từng ô checklist §5 (dán output thật, test fail thì dán nguyên lỗi — không được báo xong khi chưa chạy).
- Nếu trong lúc làm phát hiện file của mình đã bị luồng khác sửa → **dừng, báo cáo, không tự merge**.

---

## 7. Bốn câu phải hỏi chủ dự án trước khi bắt đầu hạng mục A

Không có câu trả lời thì làm hạng mục **B và C trước** (hai hạng mục này độc lập hoàn toàn), A chờ chốt:

1. **TTL khóa Tan ca** — đề xuất 10 phút tự nhả. Chốt bao nhiêu phút? Có muốn bỏ TTL, bắt buộc lễ tân bấm [Đã xử lý xong] mới nhả không (rủi ro: quên bấm là KTV kẹt)?
2. **Phạm vi khóa** — khóa toàn bộ KTV đang online, hay chỉ KTV `TYPE_D`?
3. **Ngoại lệ** — KTV đã hết giờ ca từ lâu (ca 1 tan 15:00, giờ 22:00) mà quầy bấm báo khách: khóa luôn hay tha?
4. **Thuế TNCN 10%** — v16 xếp vào Phase 1 nhưng nó thuộc Phần 1, không thuộc Phần 4. Gộp đợt này hay tách plan riêng?
