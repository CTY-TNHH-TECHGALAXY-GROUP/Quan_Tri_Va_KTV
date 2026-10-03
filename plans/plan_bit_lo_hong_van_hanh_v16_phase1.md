# Kế Hoạch Triển Khai: PHẦN 4 — BỊT LỖ HỔNG VẬN HÀNH (v16) — PHASE 1

> Nguồn yêu cầu: `E:\Oria\Chinh sach moi type D\v16.md` — **PHẦN 4** (5 lỗ hổng) và **PHẦN 5 / Phase 1**.
> Ngày soạn: 02/09/2026. Nhánh: `main`.

---

## 0. Hiện trạng sau khi đối chiếu code base

| # | Yêu cầu v16 Phần 4 | Hiện trạng | Phase |
|---|---|---|---|
| 4.1 | Lễ tân bấm **[Thông báo có khách]** → khóa nút [Tan ca] của KTV qua Realtime | ❌ **Chưa có gì** (không có nút, không có event; nút Tan ca chỉ khóa theo giờ ca + task chưa nghiệm thu) | **Phase 1** |
| 4.2 | Chặn kẹt luồng: Lễ tân chốt hóa đơn trước, KTV vẫn up ảnh dọn phòng | ✅ **Đã có** (Triple-Condition + Safety Recompute + handover không phụ thuộc status đơn) | **Phase 1 — chỉ chốt test hồi quy** |
| 4.3 | App KTV tự động đá văng Đơn Cha (`SPLIT`) | ⚠️ **Mới chặn ở phía Lễ tân/RPC**; App KTV không có logic nào về `SPLIT` | **Phase 1** |
| 4.4 | Đổi KTV giữa chừng → KTV cũ thành `CANCEL`, giữ lịch sử | ⚠️ **Lệch spec** — KTV gắn vào đơn qua `BookingItems.technicianCodes` (mảng **mã nhân viên, KHÔNG có trạng thái**); đổi người chỉ gỡ mã khỏi mảng | **Phase 2** (thiết kế chốt ở §5.1) |
| 4.5 | [Hủy tua] → KTV 0đ + **Cờ Badge Cảnh Báo** trong lịch sử, không phạt x3 giờ | ⚠️ 0đ đạt gián tiếp; **chưa có nút [Hủy tua] riêng, chưa có badge** | **Phase 2** (§5.2) |

**Phạm vi Phase 1 của tài liệu này:** hạng mục **A (4.1)**, **B (4.3)**, **C (4.2 — test hồi quy)**.
Hạng mục 4.4 / 4.5 được thiết kế sẵn ở §5 để chốt trước khi bước vào Phase 2.

---

## 1. HẠNG MỤC A — Khóa nút [Tan Ca] khi Lễ tân báo "Có khách" (4.1)

### 1.1 Phân tích
- Nút Tan ca nằm ở `app/ktv/attendance/page.tsx:594-628`, điều kiện `disabled` hiện là:
  `incompleteTasksCount > 0 || isLoadingShift || (!allowEarlyCheckout && !canCheckOut)`.
- Backend đã có tiền lệ chặn cứng CHECK_OUT tại `app/api/ktv/attendance/route.ts:119-153` (đọc config theo `work_type`: `block_checkout_incomplete_tasks_${work_type}`) → **tái sử dụng đúng khuôn mẫu này**.
- Realtime đã chạy tốt qua `postgres_changes` (xem `app/ktv/attendance/Attendance.logic.ts:186-210`); publication `supabase_realtime` đã có sẵn khuôn mẫu `ALTER PUBLICATION ... ADD TABLE`.
- Push cho KTV đã có đường duy nhất: `createNotification()` → INSERT `StaffNotifications` → DB Webhook → `app/api/notifications/trigger-webhook/route.ts`. Chỉ cần thêm 1 rule type mới.

### 1.2 Thiết kế
**Cơ chế khóa = 1 bản ghi "phiên có khách" có hạn dùng (TTL), KHÔNG phải cờ boolean toàn cục.**
Lý do: nếu là cờ boolean mà lễ tân quên tắt thì KTV kẹt cả đêm không tan ca được.

- **Bảng mới `GuestArrivalEvents`**
  - `id uuid`, `created_by text` (mã lễ tân), `created_at timestamptz`, `expires_at timestamptz`, `released_at timestamptz null`, `note text`.
  - Khóa đang hiệu lực ⟺ `released_at IS NULL AND now() < expires_at`.
  - Thêm bảng vào publication `supabase_realtime`.
- **Config mới trong `SystemConfigs`**
  - `guest_arrival_lock_enabled` (bool, mặc định `true`)
  - `guest_arrival_lock_minutes` (số, mặc định `10`) — TTL tự nhả
  - `guest_arrival_lock_TYPE_D` (bool, mặc định `true`) — bật/tắt theo loại KTV, đồng bộ khuôn mẫu `block_checkout_incomplete_tasks_${work_type}` đang có
- **Đường nhả khóa:** (a) hết `expires_at`; (b) Lễ tân bấm **[Đã xử lý xong]**; (c) tự nhả khi điều phối thành công một đơn (`dispatch_confirm_booking` trả `success`).

### 1.3 File cần chỉnh sửa

#### [NEW] `supabase/migrations/20260902090000_create_guest_arrival_events.sql`
- `CREATE TABLE IF NOT EXISTS "GuestArrivalEvents"` + index trên `expires_at`, `released_at`.
- Thêm vào publication realtime — bọc kiểm tra tồn tại theo mẫu `supabase/migrations/20260818_create_booking_guests.sql:38`.
- `INSERT INTO "SystemConfigs"` 3 key ở §1.2 theo mẫu `supabase/migrations/20260502000000_add_day_cutoff_config.sql`.

#### [NEW] `app/api/reception/guest-arrival/route.ts`
- `POST` — `requirePermission('dispatch_board')`; insert `GuestArrivalEvents` với `expires_at = now() + guest_arrival_lock_minutes`; gọi `createNotification({ type: 'GUEST_ARRIVAL', message: 'Có khách vào — tất cả KTV giữ máy, chưa được tan ca.' })`.
- `DELETE` (hoặc `PATCH { action: 'RELEASE' }`) — set `released_at = now()` cho mọi event đang mở.
- `GET` — trả trạng thái khóa hiện tại cho UI Lễ tân.

#### [MODIFY] `app/reception/dispatch/page.tsx`
- Thêm nút **[🔔 Thông báo có khách]** vào cụm toolbar cạnh nút chuông (khu vực dòng ~1800-1865).
- Hai trạng thái: bình thường → bấm để báo khách (có confirm chống bấm nhầm); đang khóa → nút đỏ + đếm ngược `mm:ss`, bấm lần 2 để **[Đã xử lý xong]** nhả khóa sớm.

#### [MODIFY] `app/api/notifications/trigger-webhook/route.ts`
- Thêm nhánh tiêu đề riêng cho `record.type === 'GUEST_ARRIVAL'`: title `🔔 CÓ KHÁCH`, giữ nguyên message, `requireOnShift: true` (chỉ KTV đang trong ca nhận).

#### [MODIFY] `SystemConfigs.notification_rules` (qua `PATCH /api/admin/notification-rules`)
- Thêm entry:
  `"GUEST_ARRIVAL": { enabled: true, allowed_roles: ["KTV","ADMIN","RECEPTION"], include_target_employee: false, require_on_shift: true }`

#### [MODIFY] `app/api/ktv/attendance/status/route.ts`
- Query event khóa đang hiệu lực, trả thêm `guestArrivalLock: { active, until, message }`.
- ⚠️ Route này có **8 nhánh return** (dòng 134-185) — phải thêm field vào **đủ cả 8**, y như cách `incompleteTasksCount` đang được truyền.

#### [MODIFY] `app/api/ktv/attendance/route.ts`
- Trong khối `if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT')` (dòng 119), sau phần check task: thêm check khóa "có khách".
- Nếu khóa bật + config theo `work_type` bật → trả **403**: *"Quầy vừa báo có khách. Vui lòng giữ máy, chưa thể tan ca lúc này."*
- **Không chặn** `checkType === 'SUDDEN_OFF'` (nghỉ nguyên ngày đầu ca) và `OFF_REQUEST` — chỉ chặn tan ca giữa/cuối ca.

#### [MODIFY] `app/ktv/attendance/Attendance.logic.ts`
- Thêm state `guestArrivalLock`, đọc từ API status (cạnh `incompleteTasksCount`, dòng ~96).
- `useEffect` subscribe realtime kênh `guest_arrival_lock` trên bảng `GuestArrivalEvents` (`event: '*'`) → cập nhật state tức thì; kèm `setTimeout` tự mở khóa đúng mốc `until` (không phụ thuộc hoàn toàn vào realtime).
- Export `guestArrivalLock` trong return object.

#### [MODIFY] `app/ktv/attendance/page.tsx`
- Thêm `guestArrivalLock.active` vào `disabled` của nút Tan ca (dòng 619) và vào nhánh đổi màu/đổi label (dòng 621-627): label `"CÓ KHÁCH — GIỮ MÁY"`.
- Thêm banner đỏ + đồng hồ đếm ngược, đặt cùng vị trí banner `incompleteTasksCount` (dòng 580-593).

#### [MODIFY] `app/ktv/attendance/_components/AttendanceTypeB.tsx`
- Nhận prop `guestArrivalLock` và disable nút Check-out tương ứng (chặn đường lách qua UI Type B).

### 1.4 Test case
1. Lễ tân bấm [Thông báo có khách] → trong ≤3 giây App KTV (đang mở màn Chấm công) tự mờ nút Tan ca + hiện banner đếm ngược.
2. KTV F5 lại app → nút vẫn mờ (state đến từ API status, không chỉ realtime).
3. Gọi thẳng `POST /api/ktv/attendance` với `checkType='CHECK_OUT'` bằng Postman → nhận **403**.
4. Hết `guest_arrival_lock_minutes` → nút tự mở lại, không cần ai thao tác.
5. Lễ tân bấm [Đã xử lý xong] trước hạn → nút mở lại ngay.
6. `guest_arrival_lock_enabled = false` → bấm nút chỉ gửi thông báo, **không** khóa.
7. KTV ca `FREE` / `REQUEST` cũng bị khóa (khóa áp cho mọi KTV đang online).

---

## 2. HẠNG MỤC B — App KTV tự đá văng Đơn Cha `SPLIT` (4.3)

### 2.1 Phân tích (cập nhật 02/09 — lỗ hổng rộng hơn bản đầu)
- RPC tách đơn `supabase/migrations/20260821165237_update_rpc_split_booking_vat.sql`:
  - dòng 76-77 `UPDATE "BookingItems" SET "bookingId" = v_new_booking_id` → items chuyển hết sang đơn con
  - dòng 136 `SET "status" = 'SPLIT'` → **đơn cha thành rỗng, không còn item nào**
  - `grep "TurnQueue\|KtvAssignments\|TurnLedger"` trong RPC = **0 kết quả** → **không remap** ba bảng này
- **Hệ quả: sau khi tách một đơn ĐÃ điều phối, có HAI bảng cùng trỏ sai vào đơn cha rỗng:**

| Bảng | Sau khi tách | Nơi bị ảnh hưởng |
|---|---|---|
| `TurnQueue.current_order_id` | vẫn = mã đơn **cha** | `handleGetBooking.ts:98-112` (nhánh 1.b resolve bookingId) |
| `KtvAssignments.booking_id` | vẫn = mã đơn **cha**, status `QUEUED`/`READY` | `handleGetBooking.ts:118-175` (AUTO-ACTIVATE ASSIGNMENT tra theo `booking_id`) |

- ⚠️ Vá mỗi `TurnQueue` là **chưa đủ** — khối auto-activate vẫn kích hoạt assignment trên đơn cha rỗng.
- Đường thoát sẵn có: KTV **đã bấm bắt đầu** trước khi tách → item `IN_PROGRESS` đã mang `bookingId` đơn con, nhánh 1.a (dòng 60-86) tự khỏi. **Ca kẹt thật:** điều phối xong, KTV chưa bấm bắt đầu, lễ tân tách đơn.
- Các query lọc đơn "còn sống" chỉ loại `COMPLETED, CANCELLED` (`handleGetBooking.ts:104, 268, 538`) — `SPLIT` lọt lưới.
- **Đã kiểm git log:** 19 commit về split/tách đơn, **không commit nào đụng `app/ktv/*` hoặc `app/api/ktv/*`**. `328eeee` chỉ vá phía lễ tân (`app/reception/dispatch/page.tsx`). `4309477` ("tách đơn ảo -A/-B cho KTV") chỉ là hậu tố hiển thị `billCode`, không liên quan `SPLIT` vật lý. `grep -rn "SPLIT\|parent_booking_id\|parentBooking" app/ktv app/api/ktv` tại HEAD = **0 kết quả**.

### 2.2 Thiết kế — 3 lớp phòng thủ
- **Lớp 1 — Lọc:** bổ sung `SPLIT` vào cả 3 chỗ `.not('status','in','("COMPLETED","CANCELLED")')` → `("COMPLETED","CANCELLED","SPLIT")`.
- **Lớp 2 — Remap:** ngay sau bước RESOLVE BOOKING ID (`handleGetBooking.ts:40-113`), **trước** khối AUTO-ACTIVATE ASSIGNMENT (thứ tự bắt buộc — đặt sau là assignment đã kịp active trên đơn cha). Nếu booking vừa resolve có `status='SPLIT'`:
  1. Tìm đơn con: `Bookings.parent_booking_id = <mã cha>` có `BookingItems.technicianCodes` chứa `techCode`, status chưa `DONE/CANCELLED`.
  2. **Có** → chuyển hướng sang đơn con, đồng thời dọn **cả hai** bảng lệch:
     - `TurnQueue.current_order_id` → mã đơn con (kèm `booking_item_id` / `booking_item_ids`)
     - `KtvAssignments` của KTV này đang trỏ đơn cha (`status IN ('QUEUED','READY','ACTIVE')`) → đổi `booking_id` sang đơn con; chỉ đụng đúng `employee_id` + `business_date` hiện tại.
  3. **Không có** → đá văng: `TurnQueue` về `current_order_id = null, booking_item_id = null, booking_item_ids = [], status = 'waiting'`; `KtvAssignments` trỏ đơn cha → `status = 'CANCELLED'` (để `QUEUED` là kẹt vĩnh viễn); rồi `return { success: true, data: null }`.

> ⛔ **Không sửa RPC tách đơn** để nó tự remap `TurnQueue`/`KtvAssignments` — đó là vùng của luồng dispatch, sửa RPC dùng chung giữa lúc nhiều luồng chạy song song là rủi ro không đáng. Phase 1 chỉ tự chữa ở phía App KTV.
- **Lớp 3 — Log:** `console.warn('🚫 [KTV] Đơn cha SPLIT bị đá văng: ...')` để truy vết khi có sự cố.

### 2.3 File cần chỉnh sửa

#### [MODIFY] `app/api/ktv/booking/_handlers/handleGetBooking.ts`
- Thêm khối `SPLIT_GUARD` sau dòng 113 — nội dung Lớp 2.
- Sửa 3 filter tại dòng 104, 268, 538 — Lớp 1.

#### [MODIFY] `app/ktv/dashboard/KTVDashboard.logic.ts`
- Trong handler realtime `Bookings` UPDATE (dòng ~1091-1112): xử lý `payload.new.status === 'SPLIT'` giống nhánh `CANCELLED` — trả KTV về `DASHBOARD` + dọn `localStorage`, **giữ nguyên** rào chắn hiện có (không đá văng khi đang ở `REVIEW/HANDOVER/REWARD`).

### 2.4 Test case
1. Điều phối 1 đơn 2 khách cho KTV → KTV mở app thấy đơn → Lễ tân **tách đơn** → App KTV tự nhảy sang đơn con của mình, timer/segment giữ nguyên.
2. Tách đơn mà KTV không thuộc đơn con nào → App KTV về Dashboard chờ, `TurnQueue` được dọn sạch, không treo màn trắng.
3. `GET /api/ktv/booking?bookingId=<mã đơn cha SPLIT>` → trả `data: null` (hoặc đơn con), tuyệt đối không trả đơn cha.
4. Prefetch đơn kế tiếp không bao giờ trả về mã đơn cha `SPLIT`.

---

## 3. HẠNG MỤC C — Chốt chống kẹt luồng Race Condition (4.2)

### 3.1 Phân tích — code đã đạt, KHÔNG sửa logic
- `app/api/ktv/booking/_handlers/handleFinishService.ts:224-231` — `newItemStatus` có chốt `item.status === 'DONE' ? 'DONE' : ...` (không lùi trạng thái) và điều kiện `alreadyRated` (khách rate trước KTV xong).
- `app/api/ktv/booking/route.ts:146-176` — **Safety Recompute** đọc lại item status sau khi commit rồi tính lại status đơn (chống 2 KTV bấm xong gần như đồng thời).
- `lib/services/HandoverService.ts:168-184` — `submitHandover` ghi `handover_images` **không** kiểm tra status Booking → quầy chốt hóa đơn trước, KTV vẫn up ảnh bình thường.

### 3.2 Việc cần làm

#### [NEW] `scripts/test_race_condition_handover.ts`
Script mô phỏng chạy `ts-node` (khuôn mẫu `scripts/simulate_type_d_*.ts`), chạy trên đơn TEST, 3 kịch bản:
1. Lễ tân set `DONE` trước → KTV `PATCH /api/ktv/booking { status: 'FEEDBACK', action: 'RELEASE_KTV', photosBase64 }` → **kỳ vọng** HTTP 200, `handover_images` được ghi, item vẫn `DONE` (không bị lùi).
2. Khách rate trước, KTV chưa bàn giao → item phải là `CLEANING` (để ScreenEngine dẫn KTV qua HANDOVER), không nhảy thẳng `DONE`.
3. Hai KTV cùng đơn bấm xong gần như đồng thời → booking không bị đẩy `DONE` sớm khi còn item `IN_PROGRESS`.

#### [MODIFY] `package.json`
- Thêm script `"test:race"` chạy file trên, đặt cạnh `test:type-d`.

---

## 4. Thứ tự thi công & ước lượng (Phase 1)

| Bước | Nội dung | Ước lượng |
|---|---|---|
| 1 | Migration `GuestArrivalEvents` + seed 3 config + rule `GUEST_ARRIVAL` | 30' |
| 2 | API `/api/reception/guest-arrival` (POST / DELETE / GET) | 30' |
| 3 | Nút [Thông báo có khách] trên màn Điều Phối | 30' |
| 4 | API status trả `guestArrivalLock` + chặn cứng 403 ở API attendance | 30' |
| 5 | UI KTV: realtime + banner + disable nút Tan ca (cả Type B) | 45' |
| 6 | `SPLIT_GUARD` trong `handleGetBooking` + realtime dashboard | 45' |
| 7 | Script test race condition + chạy 3 kịch bản | 30' |
| 8 | Test tay end-to-end theo checklist §1.4 / §2.4 | 30' |
| | **Tổng** | **~4h30** |

Thứ tự bắt buộc: **1 → 2 → 4 → (3 ∥ 5)**. Hạng mục B (bước 6) và C (bước 7) độc lập, làm song song được.

---

## 5. Chuẩn bị cho Phase 2 — hai điểm cần chốt trước khi code

### 5.1 (4.4) Đổi KTV giữa chừng → trạng thái `CANCEL`

**Vấn đề gốc (đã xác nhận trong code):** KTV được gắn vào dịch vụ qua `BookingItems.technicianCodes` — **mảng mã nhân viên thuần, không có cột trạng thái**. Muốn đánh dấu "KTV cũ = CANCEL" thì phải có chỗ chứa trạng thái.

Ba nơi có thể chứa trạng thái:

| | Nơi lưu | Ưu | Nhược |
|---|---|---|---|
| **A** | `BookingItems.segments[]` — đã có `ktvId`, `startTime`, `endTime`, `note`; thêm field `status: 'ACTIVE' \| 'CANCELLED' \| 'DONE'` + `cancelReason` | Không đổi schema; lịch sử vốn đã nằm ở đây; ví/hoa hồng đang đọc chính field này | JSON không ràng buộc kiểu, phải rà mọi nơi parse `segments` |
| **B** | `KtvAssignments.status` — **bảng này đã có sẵn cột status** (`ACTIVE / QUEUED / READY / COMPLETED / CANCELLED`) | Đúng chuẩn quan hệ; query & báo cáo dễ | Luồng đổi KTV (`swapKtvOnPausedItem`) hiện **không hề đụng tới bảng này** → phải nối thêm |
| C | Bảng mới `BookingItemTechnicians` thay `technicianCodes` | Sạch nhất về mặt dữ liệu | Đụng chạm quá rộng, không hợp phạm vi Phase 2 |

**Đề xuất chốt: làm cả A + B.** `segments[].status` là **nguồn hiển thị lịch sử** (App KTV, Ví, Lịch sử đơn); `KtvAssignments.status = 'CANCELLED'` là **nguồn trạng thái máy** (điều phối, báo cáo). Cụ thể:
- `lib/services/BookingItemPauseService.ts:314-320` — ngoài `note: 'Bị đổi người (Phạt)'`, set thêm `segments[aIndex].status = 'CANCELLED'`, `cancelReason`, `cancelledAt`.
- Cũng tại hàm đó, bổ sung `UPDATE KtvAssignments SET status='CANCELLED'` cho `oldKtvId` trên đúng `booking_item_id` (hiện hàm này không đụng bảng `KtvAssignments` lần nào).
- `supabase/migrations/20260830_add_dispatch_booking_guard.sql:70` — KTV bị gỡ khi điều phối lại đang bị set `'COMPLETED'`; cần phân biệt: gỡ khi **chưa từng làm** → `CANCELLED`; gỡ khi **đã có `actualEndTime`** → `COMPLETED`.

### 5.2 (4.5) Nút [Hủy tua] + Cờ Badge Cảnh Báo
- Hiện chỉ có "Hủy dịch vụ này" / "Hủy toàn bộ đơn hàng" (`app/reception/dispatch/page.tsx:3253, 3263`) — **chưa phân biệt** "hủy vì khách đổi ý" với "hủy vì KTV tự ý dắt khách xuống sớm".
- Cần thêm mục **[Hủy tua — Lỗi KTV]** riêng: ghi `TurnLedger.is_punished = true` (cột đã tồn tại, đang dùng tại `lib/services/BookingItemPauseService.ts:245`) kèm lý do; App KTV / Lịch sử render badge đỏ ⚠️ dựa vào cờ này.
- Ràng buộc từ v16 đã sẵn đạt: **0đ** (ví TYPE_D chỉ tính item `DONE/COMPLETED/CLEANING/FEEDBACK` — `lib/services/KtvTypeDWalletService.ts:104`) và **không phạt x3 giờ** (hiện đúng vì `KtvTypeDDisciplineService.deductOrderReject` chưa được nối vào luồng thật, mới chỉ có trong `scripts/simulate_type_d_discipline.ts`).

---

## 6. ❓ Câu hỏi cần bạn chốt trước khi code

1. **TTL khóa Tan ca**: mặc định đề xuất **10 phút** rồi tự nhả. Anh muốn để bao nhiêu phút? Có muốn ràng thêm "chỉ nhả khi Lễ tân bấm [Đã xử lý xong]" không (rủi ro: quên bấm là KTV kẹt)?
2. **Phạm vi khóa**: khóa **toàn bộ KTV đang online**, hay chỉ khóa KTV `TYPE_D` (theo tinh thần "Chính sách mới Type D")?
3. **Ngoại lệ**: KTV đã hết giờ ca từ lâu (VD ca 1 tan lúc 15:00, giờ là 22:00) mà quầy bấm báo khách — có khóa họ luôn không, hay tha?
4. **Thuế TNCN 10%**: theo v16, Phase 1 còn bao gồm hạng mục này, nhưng nó thuộc **Phần 1** chứ không thuộc Phần 4. Anh muốn gộp vào đợt code này hay tách plan riêng?

Vui lòng duyệt kế hoạch để tôi bắt tay vào Phase 1.
