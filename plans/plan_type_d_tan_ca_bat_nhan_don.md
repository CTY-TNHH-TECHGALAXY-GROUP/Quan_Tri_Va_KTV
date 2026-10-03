# Plan — KTV Loại D: sau tan ca vẫn "Oria Xin chào" + "Bật Nhận Đơn"

> Prompt gửi cho anti. Áp dụng **ANTIGRAVITY MODE** (`plans/rule_antigravity_fullstack.md`).

---

## 1. Mục tiêu nghiệp vụ

KTV Loại D làm theo **cơ chế tự do** (đăng ký ngày, không có ca cố định). Hiện tại khi đã bấm tan ca là màn Chấm Công chết cứng ở "Đã tan ca" — không quay lại làm tiếp được, cũng không nhận đơn từ nhà được.

Muốn:

- Sau khi tan ca, màn Chấm Công của D hiện lại **2 nút**: `Oria Xin chào` (quay lại tiệm làm tiếp) và `Bật Nhận Đơn` (chờ đơn từ nhà) — **hành vi giống Loại B**.
- Vào lại được thì cũng **tan ca lại được**, lặp bao nhiêu lần trong ngày cũng đúng.

Ràng buộc bắt buộc:

- **Luồng code làm việc phải TÁCH RIÊNG khỏi Loại B.** Giống về hành vi UI, không giống về code. Không được nhét `TYPE_D` vào nhánh `isTypeB`, không được dùng lại `AttendanceTypeB.tsx`, không được gọi `KtvOnlineService` (service này là của B).
- Lý do: D có tua/giờ công/kỷ luật/ví riêng (`KTVServiceHoursLedger`, `KTVTypeDDailyRegistration`, `KtvTypeDDisciplineService`, `KtvTypeDWalletService`). Dùng chung service của B sẽ ghi sai bảng ngay từ lần đầu, và mỗi lần sửa cho D sẽ làm hỏng B.

---

## 2. Source of truth

| Thứ | Nguồn thật | Ghi chú |
|---|---|---|
| Trạng thái màn Chấm Công | `KTVAttendance` (record trong Business Date) → `app/api/ktv/attendance/status/route.ts` | Business Date tính theo `spa_day_cutoff_hours` |
| Trạng thái nhận đơn ngoài giờ | `Staff.online_status` (`OFFLINE` / `ONLINE` / `AT_VENUE`) + `available_from/until`, `travel_minutes` | |
| Quyền được nhận đơn | `Staff.work_type` + `Staff.feature_flags.allow_on_call` | D hiện mặc định `false` — xem `app/admin/settings/system/KtvFeatures.logic.ts:109` |
| Lịch ngày của D | `KTVTypeDDailyRegistration` (UNIQUE `staff_id, work_date`) | `check_in_at` chỉ ghi 1 lần |
| Giờ công / kỷ luật D | `KTVServiceHoursLedger` | tính theo **booking**, KHÔNG theo cặp giờ chấm công |
| Sổ tua | `TurnQueue` (UNIQUE `employee_id, date`) | |

---

## 3. Khảo sát code — 8 điểm chặn thật sự (đọc kỹ, đây là phần quan trọng nhất)

### 3.1. `CHECKED_OUT` đang là trạng thái CHẾT — đây là bug gốc

`app/api/ktv/attendance/status/route.ts:190-230` xét record theo **thứ tự ưu tiên loại**, không theo thời gian:

```
SUDDEN_OFF  →  CHECK_OUT  →  CHECK_IN
```

Query đã `order('checkedAt', desc)` nhưng `records.find(r => r.checkType === 'CHECK_OUT' ...)` chạy **trước** nhánh CHECK_IN. Nên nếu D check-in lại lúc 20:00 sau khi đã tan ca lúc 18:00, API vẫn trả `CHECKED_OUT` vì record CHECK_OUT cũ vẫn nằm trong ngày.

→ **Không sửa được UI mà không sửa API này.** Bắt buộc phải làm.

Cách sửa (chỉ đổi cho D, tuyệt đối không đổi hành vi A/B/C):

- Với `workType === 'TYPE_D'`: bỏ bảng ưu tiên, lấy **record mới nhất theo `checkedAt`** trong Business Date (records[0] sau khi loại các bản `REJECTED`), rồi map:
  - `CHECK_OUT` + CONFIRMED → `CHECKED_OUT`
  - `CHECK_IN` / `LATE_CHECKIN` / `OVERTIME` + CONFIRMED → `CONFIRMED`
  - `SUDDEN_OFF` → giữ nguyên logic cũ, **ưu tiên tuyệt đối** (nghỉ đột xuất là chốt ngày, không cho quay lại)
  - `PENDING` → `PENDING`
- Với các loại khác: giữ nguyên khối code hiện tại, không đụng một dòng.

Tách hàm thuần để test được: `lib/attendance/resolveAttendanceStatus.ts`, nhận `(records, workType)` trả `{ checkStatus, record }`.

### 3.2. `page.tsx` khối `CHECKED_OUT` không có nút nào

`app/ktv/attendance/page.tsx:697-708` — chỉ có icon + chữ "Đã tan ca". Và toàn bộ nhánh D đang chạy chung khối `else` của `workType === 'TYPE_B'` (dòng 470).

### 3.3. `AttendanceTypeB.tsx` đã có sẵn đúng cơ chế cần — nhưng **không được dùng lại**

`app/ktv/attendance/_components/AttendanceTypeB.tsx:104-105`:

```ts
const isAtVenue = state.online_status === 'AT_VENUE' && checkStatus !== 'IDLE' && checkStatus !== 'CHECKED_OUT';
const isOffline = (state.online_status === 'OFFLINE' || state.online_status === 'AT_VENUE') && !isOnline && !isAtVenue;
```

Đúng ý muốn: tan ca xong tuy `Staff.online_status` vẫn còn `AT_VENUE` thì UI vẫn rơi về `isOffline` → hiện lại 2 nút. **Copy ý tưởng này sang component riêng của D, không import file của B.**

### 3.4. API on-call chặn cứng TYPE_D

`app/api/ktv/on-call/route.ts:33` và `:80`:

```ts
const allow_on_call = isTypeB || featureFlags.allow_on_call === true;
```

`lib/services/KtvOnlineService.ts:60` chặn lần hai. Và `KtvFeatures.logic.ts:113` set mặc định `allow_on_call: false` cho TYPE_D.

→ D gọi vào sẽ ăn 403 "Tính năng này chỉ dành cho KTV Loại B".

### 3.5. Bug trong on-call route: key config hardcode `_TYPE_B`

`app/api/ktv/on-call/route.ts:100`:

```ts
.eq('key', 'block_checkout_incomplete_tasks_TYPE_B')
```

Trong khi mọi chỗ khác (`attendance/route.ts:135`, `attendance/status/route.ts:120`) dựng key động theo `work_type`. Route riêng của D **phải** dùng `block_checkout_incomplete_tasks_TYPE_D`.

### 3.6. `KtvOnlineService` ghi sai bảng nếu đem dùng cho D

- `arriveAtVenue()` (`:196`) tạo `KTVShifts` với `shiftType: 'VIP'`, `reason: 'KTV Loại B tới tiệm'` → D phải là ca **`FREE`** (ca tự do) với reason riêng, và phải ghi `check_in_at` vào `KTVTypeDDailyRegistration`.
- `goOffline()` (`:126`) set `KTVShifts.status = 'REPLACED'`, `reason: 'KTV tự tắt app'`. Với D, tan ca đã đóng shift thành `COMPLETED` (`attendance/route.ts:452-459`) — **không được ghi đè ngược** `COMPLETED` → `REPLACED`. Đây là lỗi ghi lệch DB sẽ xảy ra ngay lần D bấm "Tắt Nhận Đơn" sau khi tan ca nếu dùng lại service của B.

### 3.7. Xung đột: check-in của D đang tự gọi `goOffline` của B

`app/api/ktv/attendance/route.ts:333-336`, trong nhánh non-B:

```ts
// 🔹 Tự động tắt trạng thái nhận đơn ngoài giờ (nếu có)
await KtvOnlineService.goOffline(supabase, staffCode);
```

Với cơ chế mới đây là hành vi sai: D đang `ONLINE` (chờ đơn ở nhà) mà bấm "Oria Xin chào" thì phải chuyển `ONLINE → AT_VENUE`, không phải `→ OFFLINE`. Tệ hơn, `goOffline` set `TurnQueue.status='off'` và đóng `KTVShifts` **ngay trước** đoạn code bên dưới tạo lại `KTVShifts` + `TurnQueue` → hai lệnh đánh nhau trên cùng một dòng DB.

### 3.8. Dead code cần dọn cùng lúc

`app/api/ktv/attendance/route.ts:162-178` — khối "Step 0.6: Validation for TYPE_D" nằm **bên trong** `if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT')` ở dòng 124. Nên nhánh `if (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN')` bên trong nó **không bao giờ chạy** → hiện tại D đã đăng ký OFF vẫn check-in được, chặn "đã đăng ký nghỉ" đang vô hiệu.

Phải đưa validation CHECK_IN của D ra ngoài, chạy độc lập. Việc này **bắt buộc** làm cùng đợt vì tính năng mới cho phép check-in nhiều lần → lỗ hổng này bị khai thác dễ hơn.

---

## 4. Việc phải làm

### Bước 1 — Tách hàm quyết định trạng thái (backend)

**File mới**: `lib/attendance/resolveAttendanceStatus.ts`

```ts
export type CheckStatus = 'IDLE' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CHECKED_OUT';

export function resolveAttendanceStatus(
  records: AttendanceRow[],   // đã sort checkedAt DESC
  workType: string
): { checkStatus: CheckStatus; record: AttendanceRow | null }
```

- `workType !== 'TYPE_D'` → giữ **nguyên xi** thứ tự ưu tiên hiện có (bê nguyên code từ `status/route.ts`, không "tiện tay" cải tiến).
- `workType === 'TYPE_D'` → SUDDEN_OFF ưu tiên tuyệt đối; còn lại lấy record mới nhất không `REJECTED`.

**Sửa**: `app/api/ktv/attendance/status/route.ts` gọi hàm này thay cho khối `records.find(...)`.

### Bước 2 — Service riêng cho D

**File mới**: `lib/services/KtvTypeDOnlineService.ts`. **Không** import, **không** kế thừa `KtvOnlineService`.

| Method | Việc phải làm | Khác gì so với B |
|---|---|---|
| `goOnline(supabase, {staffId, travelMinutes, availableFrom, availableUntil})` | validate `work_type === 'TYPE_D'` và `feature_flags.allow_on_call === true`; set `online_status='ONLINE'` + `travel_minutes` + `available_from/until` | phải chặn nếu hôm nay là `OFF_REGISTERED` trong `KTVTypeDDailyRegistration` (đăng ký nghỉ thì không được nhận đơn) |
| `goOffline(supabase, staffId)` | set `online_status='OFFLINE'`, clear window; `TurnQueue` set `off` theo Business Date | **chỉ đóng `KTVShifts` khi record đang `ACTIVE`** — không được đụng record `COMPLETED` |
| `arriveAtVenue(supabase, staffId)` | `online_status='AT_VENUE'`; mở `KTVShifts` `shiftType='FREE'`, `reason='KTV Loại D tới tiệm'`; upsert `TurnQueue` `waiting`; ghi `check_in_at` nếu còn `null` | B dùng `VIP`, D dùng `FREE` |

Business Date: dùng chung `spa_day_cutoff_hours` như `KtvOnlineService.goOffline` đang làm — copy đúng công thức, đừng tự chế.

### Bước 3 — API riêng cho D

**File mới**: `app/api/ktv/type-d/on-call/route.ts` (GET + POST), song song với `app/api/ktv/on-call/route.ts`, **không sửa route của B**.

- GET trả `{ allow_on_call, is_on_call, online_status, travel_time_mins }` — cùng shape với route B để component D dùng chung interface, nhưng dữ liệu lấy đường riêng.
- POST: khi tắt nhận đơn, kiểm tra
  1. `block_checkout_incomplete_tasks_TYPE_D` → còn task chưa `PASSED` thì chặn (không hardcode `_TYPE_B`).
  2. `GuestArrivalEvents` chưa `released_at` + `hasPendingDispatch()` → chặn, dùng lại `lib/guest-arrival.logic.ts`.

Thêm endpoint vào `lib/api-endpoints.ts` (ví dụ `API.KTV.TYPE_D_ON_CALL`), không đụng `API.KTV.ON_CALL`.

### Bước 4 — Component riêng cho D

**File mới**: `app/ktv/attendance/_components/AttendanceTypeD.tsx`. Copy cấu trúc từ `AttendanceTypeB.tsx` nhưng gọi endpoint của D, và:

- 3 trạng thái: `ĐANG TẮT` / `ĐANG CHỜ ĐƠN` / `ĐÃ TỚI TIỆM` — cùng công thức `isAtVenue` loại trừ `CHECKED_OUT` như §3.3.
- `ĐANG TẮT` → 2 nút: `Oria Xin chào` (mở form check-in) + `Bật Nhận Đơn` (popup giờ di chuyển).
- `ĐANG CHỜ ĐƠN` → `Oria Xin chào` + `Tắt Nhận Đơn`.
- `ĐÃ TỚI TIỆM` → `Oria Xin cảm ơn` (tan ca), có chặn `guestArrivalLock` và `incompleteTasksCount` như B.
- Nếu hôm nay `OFF_REGISTERED` → khoá cả hai nút, hiện lý do rõ ràng.

**Sửa** `app/ktv/attendance/page.tsx` dòng 470: thêm nhánh thứ hai

```tsx
) : workType === 'TYPE_D' && user?.code ? (
    <AttendanceTypeD ... />
) : (
```

Khi đó khối `IDLE/CONFIRMED/CHECKED_OUT` mặc định không còn phục vụ D nữa → rà lại: `OnCallWidget` (dòng 494) hiện chỉ bật khi `isOffToday` — nó dành cho A/C, **giữ nguyên**, đừng gộp.

### Bước 5 — Sửa nhánh check-in/check-out của D trong `attendance/route.ts`

- Tách nhánh `workType === 'TYPE_D'` ra khỏi khối `else` chung (hiện D đang chạy chung đường với A/C).
- CHECK_IN của D: thay `KtvOnlineService.goOffline(...)` bằng `KtvTypeDOnlineService.arriveAtVenue(...)`. Bỏ đoạn tự tạo `KTVShifts`/`TurnQueue` trùng lặp — để service làm một chỗ.
- CHECK_OUT của D: gọi `KtvTypeDOnlineService.goOffline(...)` sau khi đã đóng shift `COMPLETED`; đảm bảo `online_status` về `OFFLINE` để lần bật nhận đơn kế tiếp sạch trạng thái.
- Đưa validation `OFF_REGISTERED` cho CHECK_IN ra khỏi khối CHECK_OUT (bug §3.8).
- Check-in lần 2+ trong ngày: `check_in_at` giữ `.is('check_in_at', null)` — **không ghi đè**, để cron chấm công/kỷ luật vẫn thấy giờ đến đầu tiên.

### Bước 6 — Mở cờ quyền

`app/admin/settings/system/KtvFeatures.logic.ts:109` — case `TYPE_D`: `allow_on_call` mặc định đang `false`. Đổi thành `true`, hoặc để admin bật tay trong tab "Loại D".

---

## 5. Không được đụng

- `AttendanceTypeB.tsx`, `OnCallWidget.tsx`, `app/api/ktv/on-call/route.ts`, `lib/services/KtvOnlineService.ts` — trừ khi có lý do viết ra rõ ràng.
- Nhánh `isTypeB` trong `app/api/ktv/attendance/route.ts`.
- Thứ tự ưu tiên trạng thái của A/B/C trong `status/route.ts`.
- Công thức tính giờ công/tua của D (`KTVServiceHoursLedger` tính theo booking, không theo giờ chấm công → check-in nhiều lần trong ngày **không** làm sai giờ công; xác nhận lại điều này bằng test rồi mới kết luận).

---

## 6. Rủi ro đã biết, phải xử lý hoặc nói rõ là chấp nhận

1. **Nhiều cặp CHECK_IN/CHECK_OUT trong 1 ngày** — rà mọi nơi đọc `KTVAttendance` giả định 1 cặp/ngày: trang lịch sử chấm công, payroll, `app/api/finance/ktv-summary/route.ts`, các báo cáo admin. Chỗ nào lấy `.single()` hoặc "check-in đầu / check-out đầu" thì phải đổi sang `min(check_in)` / `max(check_out)`.
2. **Cron `daily-absence-check`** — có sẵn 1 bug độc lập: dòng `.eq('employeeId', staff.id)` so mã `Staff.id` với cột `KTVAttendance.employeeId` (vốn là `Users.id`) → fallback "quên đăng ký nhưng vẫn đi làm" gần như không bao giờ khớp; cron cũng dùng `date` theo lịch chứ không theo Business Date. Không nằm trong phạm vi đợt này — **báo lại, đừng tự sửa chung**, nhưng phải xác nhận tính năng mới không làm nó phạt nhầm người đã tan ca rồi quay lại.
3. **Kẹt `AT_VENUE` qua ngày** — `status/route.ts:172-179` có auto-reset khi không còn record trong ngày. Kiểm tra lại nó vẫn đúng khi D có nhiều record.
4. **Race** — D bấm "Bật Nhận Đơn" và lễ tân điều phối đồng thời. Backend phải đọc state hiện tại trước khi ghi, không tin payload.

---

## 7. Cách verify (bắt buộc chạy, không được kết luận suông)

Trên 1 tài khoản D thật:

1. Đăng ký làm hôm nay → `Oria Xin chào` → màn hiện `ĐÃ TỚI TIỆM`; DB: `online_status='AT_VENUE'`, `KTVShifts` `FREE/ACTIVE`, `TurnQueue` `waiting`, `check_in_at` có giá trị.
2. `Oria Xin cảm ơn` → `CHECKED_OUT`; `KTVShifts` `COMPLETED`, `TurnQueue` `off`, `online_status='OFFLINE'`.
3. **Sau tan ca, màn phải hiện lại 2 nút.** ← điểm nghiệm thu chính.
4. Bấm `Bật Nhận Đơn`, chọn 30 phút → `ĐANG CHỜ ĐƠN`; `online_status='ONLINE'`; KTV xuất hiện ở bảng "KTV Online" của Điều Phối (`DispatchOnlineKtvTable`).
5. Bấm `Oria Xin chào` từ trạng thái ONLINE → `AT_VENUE`, `TurnQueue` quay lại `waiting`, `KTVShifts` mở record `ACTIVE` mới, `check_in_at` **giữ nguyên giờ lần đầu**.
6. Tan ca lần 2 → đúng như bước 2. Lặp lại lần 3 vẫn đúng.
7. `Tắt Nhận Đơn` khi còn task chưa `PASSED` → bị chặn với đúng thông báo TYPE_D.
8. Quầy bấm "Báo có khách" (còn đơn chờ) → cả `Oria Xin cảm ơn` lẫn `Tắt Nhận Đơn` đều bị chặn.
9. Đăng ký OFF hôm nay → cả `Oria Xin chào` lẫn `Bật Nhận Đơn` đều bị chặn (kiểm cả UI lẫn API — gọi thẳng API bằng curl để chắc backend chặn thật).
10. **Hồi quy Loại B**: chạy lại toàn bộ luồng B (bật nhận đơn → tới tiệm → tan ca → bật lại) — phải không đổi một hành vi nào.
11. `npx tsc --noEmit` sạch; `npm run test:type-d` xanh.

---

## 8. Output bắt buộc khi anti báo xong

- Source of truth từng trạng thái.
- Danh sách file đã sửa/thêm, kèm lý do từng file.
- Xác nhận `KtvOnlineService` / route B / `AttendanceTypeB.tsx` **không bị sửa** (dán `git diff --stat`).
- Chỗ nào còn risk chưa đóng.
- Log/ảnh chụp DB của 11 bước verify ở §7 — không chấp nhận "đã test ok".
