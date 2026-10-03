# Plan: Điều phối KTV chưa điểm danh (popup xác nhận) + tag Sổ tua + loại C điểm danh như B

> **Mức 2** — chạm cổng điều phối (`app/reception/dispatch/actions.ts`), dịch vụ điểm danh (`KtvOnlineService`, `KtvTypeDOnlineService`), API chấm công, Sổ tua, dashboard KTV.
> Ngày lập: 14/09/2026. Nhánh: `feat/bit-lo-hong-phase1`.
> **Gộp và thay thế** `plans/plan_ktv_loai_c_diem_danh_nhu_b.md` (chưa làm).
> **Đã duyệt & đã làm 14/09/2026** — xem mục 6.

---

## 0. User chốt (14/09/2026)

| # | Chốt |
|---|---|
| 1 | Áp dụng **tất cả loại KTV**. Test ưu tiên **C và D**. |
| 2 | KTV chưa điểm danh: quầy **gõ đúng tên hoặc mã** → **popup** "NV mã … chưa điểm danh, OK để tiếp tục gửi đơn" → gửi được. Popup **ở mỗi đơn** cho tới khi KTV bấm Oria xin chào. |
| 3 | **Sổ tua** có tag **"Chưa điểm danh · Oria xin chào"**. |
| 4 | Loại **D** không bấm điểm danh **vẫn bị phạt** (cron giữ nguyên) + **thêm cảnh báo điểm danh**. |
| 5 | Miễn phạt trễ cho D đã làm đơn trước khi bấm Oria xin chào — **cần xem xét thêm, KHÔNG làm trong plan này**. |
| 6 | Loại C chấm công **giống B** (Bật nhận đơn + phút tới → Oria xin chào → Oria xin cảm ơn / Tắt). C tắt nhận đơn → ẩn khỏi ô chọn. Bỏ quyết định 13/09 "C luôn hiện, không xét gì". |

---

## 1. Hiện trạng (đã kiểm code + DB)

- **Ô chọn KTV thật chỉ có `QuickDispatchTable`** (`page.tsx:2676`). `DispatchServiceBlock` / `DispatchStaffRow` là code chết (không nơi nào render).
- KTV chưa điểm danh **không nằm trong ô chọn**: không có dòng TurnQueue → không vào `turns` (`useDispatchBoard.logic.ts` `mergeTurnsWithStaff`); dropdown lọc `status !== 'off'` (`QuickDispatchTable.tsx:1185`).
- Gõ đúng mã + Enter mà không khớp `availableTurns` → **xoá ô, không báo gì** (`QuickDispatchTable.tsx:1382`).
- Cổng server `processDispatch` (`actions.ts:647-671`): mọi loại **trừ C** phải có TurnQueue hôm đó ≠ `off`, không thì `success:false` → `handleDispatch` `alert` rồi dừng (`page.tsx:1551-1562`).
- **Loại C không chấm công được**: rơi vào giao diện A, không có ca → `shiftFetchError` → khoá nút gửi (`page.tsx:1041`). DB: KTV01–KTV05 có 0 `KTVShifts`, 0 `KTVAttendance`.

### Ba lỗi sẵn có sẽ bị kích hoạt khi cho phân KTV chưa điểm danh

| # | Lỗi | Bằng chứng |
|---|---|---|
| L1 | **Bấm Oria xin chào giữa đơn ghi đè đơn đang làm**: C/B (`KtvOnlineService.arriveAtVenue` **upsert** `status:'waiting'`, cả `turns_completed:0`) và D (`KtvTypeDOnlineService.arriveAtVenue` **update** `status:'waiting'` vô điều kiện) → quầy thấy KTV rảnh, phân chồng; RPC/`promote_next_assignment` đóng phiếu ACTIVE đang làm. Nhánh A thì đúng: chỉ đổi `off → waiting` (`attendance/route.ts:471-479`). | `KtvOnlineService.ts:208-218`, `KtvTypeDOnlineService.ts:210-213` |
| L2 | **Người chưa điểm danh nhảy lên đầu tua**: DB `TurnQueue.check_in_order DEFAULT 1`, `queue_position DEFAULT 1` (đọc `information_schema` 14/09). RPC không set 2 cột này → dòng tạo khi phân đơn nhận **#1** → đứng đầu A/B/C (`turns_completed ASC, check_in_order ASC`), đầu nhóm bằng giờ ở D. | `20260830_add_dispatch_booking_guard.sql:257-284` |
| L3 | **Loại D đã làm đơn vẫn bị cron phạt vắng** (chỉ xét `KTVAttendance` CHECK_IN hoặc `check_in_at`). | `daily-absence-check/route.ts:89-157` — **user chốt GIỮ NGUYÊN**, chỉ thêm cảnh báo |

---

## 2. Thiết kế

### 2.1 Định nghĩa "đã điểm danh hôm nay" — MỘT nguồn

`lib/attendance/checkedInToday.ts` (mới):
```
checkedInStaffIds(supabase, staffIds, businessDate) → Set<string>
```
- `KTVAttendance`: `checkType IN (CHECK_IN, LATE_CHECKIN)`, `status = CONFIRMED`, `checkedAt ∈ businessDayRange(businessDate, getDayCutoffHours())` (`lib/business-date.ts:82`).
- Map `employeeId` (= `Users.id`) → `Staff.id` qua `Users.code` (tài khoản cũ có thể `Users.id ≠ code`).
- Vì sao nguồn này: là bản ghi **duy nhất** sinh ra đúng lúc KTV bấm Oria xin chào; quầy bật tay Sổ tua, RPC phân đơn, "Lưu thứ tự" đều **không** ghi vào. `check_in_order` / `online_status` / `isOnShift` / `DailyAttendance` đều sai ở nhiều luồng (khảo sát 14/09).

Dùng chung ở: cổng `processDispatch`, `getDispatchData` (ô chọn), `/api/turns` (Sổ tua).

### 2.2 Cổng server `processDispatch` — xác nhận thay vì chặn

`dispatchData` thêm field tuỳ chọn `confirmedUncheckedKtvIds?: string[]`.

Với mỗi mã KTV trong đơn, xét theo thứ tự:
1. Không có trong `Staff` → lỗi cứng như cũ.
2. **Chưa điểm danh hôm nay** (2.1) **hoặc** dòng TurnQueue hôm đó đang `off` → nếu **không** nằm trong `confirmedUncheckedKtvIds` → trả:
   ```
   { success:false, code:'NEED_CHECKIN_CONFIRM',
     ktvs:[{ id, name, workType, reason: 'NOT_CHECKED_IN' | 'TURNED_OFF' }] }
   ```
3. Được xác nhận → cho qua. Nếu KTV **chưa có dòng TurnQueue** → **tạo trước** dòng `status:'waiting'`, `check_in_order = max+1`, `queue_position = max+1` rồi mới gọi RPC (RPC upsert thành `assigned`, không đụng 2 cột thứ tự) → **sửa L2 không cần migration**.
4. **Bỏ miễn trừ loại C** (C xét như mọi loại).

Popup do server quyết → mọi đường gửi đơn đều đi qua, client không lách được.

### 2.3 Màn điều phối — gõ tay + popup

| File | Đổi |
|---|---|
| `page.tsx` `handleDispatch` (`:1551-1562`) | Nhận `code === 'NEED_CHECKIN_CONFIRM'` → mở `ConfirmActionModal` (state `confirmModal` có sẵn `:259`) với nội dung liệt kê từng người, VD: **"NV KTV01 – LISA chưa điểm danh (chưa bấm Oria xin chào). OK để tiếp tục gửi đơn?"**; D thêm dòng *"Loại D: không điểm danh trong ngày vẫn bị phạt vắng theo quy định."*; `TURNED_OFF` → *"đang tắt nhận đơn / đã tan ca"*. OK → gọi lại `handleDispatch` truyền `confirmedUncheckedKtvIds`. |
| `page.tsx:2676` | Truyền thêm `staffs` (danh sách KTV từ `getDispatchData`) cho `QuickDispatchTable`. |
| `QuickDispatchTable.tsx:1382` (Enter) | Không khớp `availableTurns` (hoặc khớp nhưng `off`) → tra **khớp đúng** mã / `full_name` trong `staffs` (không phân biệt hoa thường, trim) → `addKtv(id)`. Gõ một phần vẫn **không** hiện người chưa điểm danh. |
| `QuickDispatchTable.tsx:1375, 1442, 466, 514` | Tên/nhãn loại tra dự phòng từ `staffs` khi không có trong `availableTurns` (hiện đang coi là loại C). |
| `QuickDispatchTable.tsx:1428-1430` | Câu miss: *"Không thấy trong danh sách đã điểm danh. Gõ đúng mã hoặc đúng tên rồi Enter để chọn KTV chưa điểm danh."* |
| `useDispatchBoard.logic.ts` `mergeTurnsWithStaff` | **Bỏ** tua ảo "luôn có" cho loại C (chốt 6). Giữ tua ảo on-call. |
| `useDispatchBoard.logic.ts` | Giữ `staffs` gốc (bản `full_name` bị ghi đè bằng `ktvName` của đơn ở `:461-473` không dùng để so khớp). |

### 2.4 Tag "Chưa điểm danh · Oria xin chào"

| Nơi | Đổi |
|---|---|
| `app/api/turns/route.ts` (sau `allTurns` `:42-47`) | Gán `checked_in_today` cho từng dòng bằng helper 2.1 theo `date` của dòng (không theo ngày lịch — tránh lệch 0h–6h). |
| `TurnQueueBoard.types.ts` | `checked_in_today?: boolean`. |
| `TurnQueueBoard.tsx` `renderTurnRow` (sau tag ca `:207`) và tab C (sau `:469`) | Tag hổ phách **"Chưa điểm danh · Oria xin chào"** khi `checked_in_today === false`, `status !== 'off'`, không nằm trong `suddenOffs`. Realtime có sẵn (`KTVAttendance` → `fetchTurns`) → tag tự mất khi KTV bấm. |
| `getDispatchData` (`actions.ts:132-160`) + `QuickDispatchTable.tsx:1406-1424` | Cùng cờ, hiện nhãn nhỏ "Chưa điểm danh" ở ô chọn; realtime patch (`useDispatchBoard.logic.ts:533-545`) giữ cờ. |

### 2.5 Sửa L1 — Oria xin chào không ghi đè đơn đang làm

| File | Đổi |
|---|---|
| `lib/services/KtvOnlineService.ts` `arriveAtVenue` (`:204-218`, dùng cho B và C) | Bỏ upsert. Chưa có dòng → insert (`max+1`, `waiting`); dòng `off` → `waiting`; dòng `assigned`/`working`/`waiting` → **không đổi status, không reset `turns_completed`**. |
| `lib/services/KtvTypeDOnlineService.ts` `arriveAtVenue` (`:210-213`) | Chỉ `off → waiting`; dòng đang bận giữ nguyên. |

Hành vi bình thường của B/D (bấm khi chưa có dòng / đang tắt) **không đổi**.

### 2.6 Loại C chấm công như B (từ plan cũ)

| File | Đổi |
|---|---|
| `app/ktv/attendance/Attendance.logic.ts` | `usesTypeBAttendanceFlow(workType) = TYPE_B \|\| TYPE_C`; `checkIsLate` bỏ qua C; `shiftFetchError` = `false` cho C. |
| `app/ktv/attendance/page.tsx:294, 437, 450, 480, 487, 762-763, 798, 927, 938, 1008, 1010, 1041` | Các điều kiện "loại B" → "B hoặc C": C dùng `AttendanceTypeB`, chọn ca `VIP`, nhập giờ dự kiến về, không lý do đi muộn. |
| `app/api/ktv/attendance/route.ts:76` | `isTypeB` → B hoặc C → `arriveAtVenue` / `goOffline`. |
| `app/api/ktv/on-call/route.ts` | Tắt nhận đơn: KTV loại C đọc `block_checkout_incomplete_tasks_TYPE_C`; loại khác giữ key cũ. |
| `TurnQueueBoard.tsx` tab C | Chữ mô tả → *"Bật để quầy chọn được ở Điều phối (hoặc gõ đúng mã khi gửi đơn)"*. |

Không sửa lỗi `Users.staffCode` (cột không tồn tại) trong `KtvOnlineService` — C không cần ca; ngoài phạm vi (user dặn chỉ tập trung C).

### 2.7 Cảnh báo điểm danh phía KTV (chốt 4)

- Component mới `app/ktv/dashboard/_components/CheckInReminder.tsx`: **tự gọi** `API.KTV.ATTENDANCE_STATUS(user.id)` (không đụng `KTVDashboard.logic.ts` — rule mục 8). Hiện khi `checkStatus === 'IDLE'` **và** KTV đang có đơn (`logic.booking` / đơn chờ xác nhận):
  > ⚠️ **Bạn chưa điểm danh hôm nay.** Vào Chấm công bấm **Oria xin chào**. *(Loại D: không điểm danh sẽ bị phạt vắng theo quy định.)*
- Gắn trong `ScreenDashboard.tsx` **ngay dưới header** (trên thẻ đơn chờ xác nhận, vì khi `needsAcceptance` phần dưới bị giấu). Nút đi tới `/ktv/attendance`.
- Chữ đặt trong `*.i18n.ts` (rule mục 6).

---

## 3. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Chấm công C (giao diện B); cảnh báo chưa điểm danh ở dashboard; Oria xin chào không phá đơn đang làm | Điều phối: gõ đúng mã/tên + popup; tag ở ô chọn; Sổ tua tag; tab C | `processDispatch`, `/api/turns`, `getDispatchData`, `KtvOnlineService`, `KtvTypeDOnlineService`, helper `checkedInToday` | Sửa |
| Tiền / tua / giờ | Không đổi — giờ & tiền D không phụ thuộc điểm danh (`KtvDLedgerEngine.ts:408-422`); tua A/B/C theo `TurnLedger` | Không đổi. **Sửa L2**: người chưa điểm danh không còn chen lên #1 tua | `TurnQueue.check_in_order/queue_position` | Khớp — sửa lệch thứ tự |
| Kỷ luật D | Không điểm danh → **vẫn phạt vắng** (giữ nguyên) + được cảnh báo | Popup nhắc quầy | `daily-absence-check` | Không đổi công thức |
| Realtime | Như cũ | Sổ tua đã subscribe `KTVAttendance`; điều phối nhận event `TurnQueue` khi KTV bấm Oria xin chào | `TurnQueue`, `KTVAttendance` | Đồng bộ |
| Quyền xem | Không lộ | Popup chỉ hiện mã, tên, loại | — | Không lộ |

---

## 4. Kiểm thử (ưu tiên C và D)

**A. Mô phỏng Node — cổng `processDispatch` + helper `checkedInToday`** (fixture đúng định dạng DB, chạy thêm `TZ=UTC`):

| Ca | Mong đợi |
|---|---|
| C chưa điểm danh, không xác nhận | `NEED_CHECKIN_CONFIRM` reason `NOT_CHECKED_IN` |
| C chưa điểm danh, đã xác nhận, chưa có dòng TurnQueue | qua; tạo trước dòng `check_in_order = max+1` (không #1) |
| C đã Oria xin chào | qua, không popup |
| C tắt nhận đơn (dòng `off`) | `NEED_CHECKIN_CONFIRM` reason `TURNED_OFF` |
| D chưa điểm danh, xác nhận | qua; popup có dòng cảnh báo phạt |
| D đã điểm danh | qua |
| 2KTV-1DV: C chưa + A đã | popup chỉ liệt kê C |
| 1KTV-2DV (gộp): D chưa điểm danh | 1 popup, 1 dòng TurnQueue |
| Đơn thứ 2 cùng ngày, KTV vẫn chưa bấm Oria xin chào (dòng đã `waiting`) | **vẫn popup** (chốt 2) |
| Ca đêm: điểm danh 23:30, phân đơn 00:30 | cùng ngày làm việc → không popup |
| Điểm danh 05:50, cutoff 6h | thuộc ngày làm việc hôm trước → popup |
| Tài khoản cũ `Users.id ≠ Users.code` | vẫn nhận đúng |
| A / B cùng các ca trên | hành vi như C (áp tất cả loại) |

**B. Chạy thật trên DB test (khuôn `scripts/qa/qa_swap_ktv_e2e.ts`, tài khoản T0xx, ngày 01/09, tự dọn)** — sửa L1:

| Ca | Mong đợi |
|---|---|
| C: phân đơn (dòng `assigned`) → `KtvOnlineService.arriveAtVenue` | status vẫn `assigned`, `turns_completed` giữ |
| C: đang `working` → arriveAtVenue | vẫn `working`, phiếu ACTIVE không bị đóng |
| D: đang `working` → `KtvTypeDOnlineService.arriveAtVenue` | vẫn `working` |
| C/D chưa có dòng → arriveAtVenue | tạo `waiting`, `check_in_order = max+1` |
| C/D dòng `off` → arriveAtVenue | `waiting` |
| `qa_swap_ktv_e2e.ts` | vẫn 121/121 |

**C. Chạy thật trên app (user, cần đăng nhập)**: KTV01 (C) và một KTV D test chưa điểm danh → quầy gõ đúng mã → popup → OK → KTV thấy cảnh báo trên dashboard → Sổ tua có tag → KTV bấm Oria xin chào → tag mất, đơn đang làm không bị đổi trạng thái → đơn kế tiếp không còn popup.

Sau đó `npx tsc --noEmit`; cập nhật `TableInSupabase.md` (ghi chú DEFAULT 1 của `check_in_order/queue_position`), `plans/plan_ktv_loai_c_tai_khoan_that.md` (mục 7 bị thay).

---

## 5. Ngoài phạm vi / còn mở

- Miễn phạt trễ D khi đã làm đơn trước lúc bấm Oria xin chào (chốt 5 — cần xem xét).
- Lỗi `Users.staffCode` trong `KtvOnlineService` (B không ghi ca / `isOnShift`).
- `Staff.online_status` không reset theo ngày; mở màn chấm công khi kẹt `AT_VENUE` từ hôm trước gọi `goOffline` → TurnQueue hôm nay `off`, có thể đè đơn đang làm (`attendance/status/route.ts:260-268`).
- `DispatchServiceBlock` / `DispatchStaffRow` là code chết.
- Bản ở quầy vẫn chạy code cũ tới khi `main` được merge + deploy.

---

## 6. Kết quả thực hiện (14/09/2026)

| Phần | File | Ghi chú |
|---|---|---|
| Nguồn "đã điểm danh" | `lib/attendance/checkedInToday.ts` (mới) | `KTVAttendance` CONFIRMED trong `businessDayRange`, map `Users.code`; lỗi → tập rỗng (hỏi thừa, không lọt) |
| Luật cổng | `lib/attendance/dispatchCheckinGate.ts` (mới, hàm thuần) | `NOT_CHECKED_IN` / `TURNED_OFF`; xác nhận chỉ sống trong 1 lần gửi |
| Cổng server | `app/reception/dispatch/actions.ts` `processDispatch` | trả `code: NEED_CHECKIN_CONFIRM` + `ktvs`; nhận `confirmedUncheckedKtvIds`; bỏ miễn trừ loại C; tạo sẵn dòng cuối hàng trước RPC. `getDispatchData` gắn `checked_in_today` |
| Popup quầy | `app/reception/dispatch/page.tsx` `handleDispatch`, `CheckinConfirm.i18n.ts` (mới), `ConfirmActionModal` (`whitespace-pre-line`) | hỏi → OK gửi lại, áp cho các payload sau cùng lần bấm; Hủy bỏ = dừng |
| Gõ đúng mã/tên | `QuickDispatchTable.tsx` (`pickKtvByExactInput`, prop `staffs`), nhãn "Chưa điểm danh" ở dropdown | gõ một phần vẫn chỉ hiện người có trong sổ tua |
| Ô chọn KTV | `useDispatchBoard.logic.ts` | bỏ tua ảo "luôn có" loại C; tua ảo on-call `checked_in_today: false`; nghe `KTVAttendance` INSERT |
| Sổ tua | `/api/turns` (`checked_in_today`, `includeTypeC=1`), `TurnQueueBoard.*` (+ `TurnQueueBoard.i18n.ts`) | tag ở danh sách chính và tab C. **Sửa kèm:** tab C trước đây không bao giờ nhận dòng tua của C vì API mặc định loại C |
| Sửa L1 | `lib/services/TurnQueueRowService.ts` (mới) `applyArrivalToTurnQueue`, dùng ở `KtvOnlineService` (B/C) + `KtvTypeDOnlineService` (D) | dòng `assigned`/`working` giữ nguyên; B/C rảnh vẫn dời cuối hàng như cũ, D giữ chỗ |
| Sửa L2 | `ensureTurnRowsAtEnd` | không migration |
| Loại C điểm danh như B | `Attendance.logic.ts` (`usesTypeBAttendanceFlow`), `app/ktv/attendance/page.tsx`, `api/ktv/attendance/route.ts` (`usesOnCallFlow`), `api/ktv/on-call/route.ts` (key `_TYPE_C`) | |
| Cảnh báo KTV | `app/ktv/dashboard/_components/CheckInReminder.tsx` (+ i18n), gắn trong `ScreenDashboard.tsx` trên thẻ đơn | tự gọi API trạng thái, không đụng `KTVDashboard.logic.ts` |
| **Sửa kèm (phát hiện khi làm)** | `app/api/ktv/attendance/status/route.ts` | "Auto-Protect" gọi `goOffline` (TurnQueue `off`) khi kẹt `AT_VENUE` — nay bỏ qua nếu đang có dòng `assigned`/`working` (cảnh báo gọi API này mỗi phút, không chặn là mất đơn khỏi bảng điều phối) |

**Kiểm:**
- `npx tsc --noEmit` sạch.
- `scripts/qa/qa_dispatch_unchecked_ktv.ts` (mới): **35/35**, giờ máy và `TZ=UTC` — 11 ca luật cổng (C/D ưu tiên), 6 ca popup, DB thật ngày 15/01/2026: khoảng ngày làm việc (23:30, qua 0h, trước mốc cắt ca, PENDING, CHECK_OUT), Oria xin chào không đè đơn C/B/D, dòng mới cuối hàng, race, `ensureTurnRowsAtEnd`. Tự dọn, dừng nếu ngày thử có dữ liệu.
- `scripts/qa/qa_swap_ktv_e2e.ts`: vẫn **121/121**.
- **Chưa kiểm trên trình duyệt** (cần đăng nhập quầy + KTV) — mục 4.C cho user.

**Còn mở:** như mục 5 (miễn phạt trễ D, `Users.staffCode`, `online_status` không reset theo ngày, code chết `DispatchServiceBlock`/`DispatchStaffRow`, chưa deploy).
