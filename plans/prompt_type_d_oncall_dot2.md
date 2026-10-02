# Đợt 2 — KTV Loại D nhận đơn: rà tiến độ + 6 lỗi phải sửa

> Prompt gửi cho anti. Nối tiếp `plans/plan_type_d_tan_ca_bat_nhan_don.md` và `plans/prompt_fix_type_d_allow_on_call.md`. Áp dụng **ANTIGRAVITY MODE**.

---

## 1. Luồng đúng (chốt lại, đây là contract)

```
ĐẦU NGÀY (OFFLINE)
   ├─ [Oria Xin chào]  → chỉ bấm được KHI ĐÃ ĐẾN TIỆM (chặn bằng IP Wi-Fi spa)
   │                     → AT_VENUE → vào sổ tua → làm tua
   └─ [Bật Nhận Đơn]   → chọn SỐ PHÚT DI CHUYỂN
                         → giờ rảnh = GIỜ HIỆN TẠI + SỐ PHÚT ĐÓ  (hệ thống tự tính)
                         → ONLINE, hiện trên màn Điều Phối

AT_VENUE → [Oria Xin cảm ơn] → tan ca → CHECKED_OUT

CHECKED_OUT → quay lại đúng màn ĐẦU NGÀY: lại có [Oria Xin chào] + [Bật Nhận Đơn]
              lặp bao nhiêu lần trong ngày cũng được
```

Đây là **một phần luồng điểm danh của Loại B** về mặt hành vi — nhưng code đi đường riêng (đã tách xong ở đợt 1, giữ nguyên).

---

## 2. Tiến độ: khung đã xong, chưa chạy được

Đã có và đúng hướng:

| Hạng mục | File | Trạng thái |
|---|---|---|
| Tách hàm trạng thái | `lib/attendance/resolveAttendanceStatus.ts` | ✅ D lấy record mới nhất, SUDDEN_OFF ưu tiên tuyệt đối |
| Service riêng | `lib/services/KtvTypeDOnlineService.ts` | ✅ `goOnline/goOffline/arriveAtVenue`, ca `FREE`, chỉ đóng `ACTIVE` |
| API riêng | `app/api/ktv/type-d/on-call/route.ts` | ✅ dùng đúng key `block_checkout_incomplete_tasks_TYPE_D` |
| Component riêng | `app/ktv/attendance/_components/AttendanceTypeD.tsx` | ✅ 3 trạng thái, `isAtVenue` loại trừ `CHECKED_OUT` |
| Nhánh D trong page | `app/ktv/attendance/page.tsx:475` | ✅ |
| Nhánh D trong attendance API | `app/api/ktv/attendance/route.ts` | ✅ `arriveAtVenue` / `goOffline`, bỏ `KtvOnlineService` |
| Dọn dead code `OFF_REGISTERED` | `attendance/route.ts` Step 0.6 | ✅ đã đưa ra ngoài khối CHECK_OUT |
| Không đụng Loại B | `KtvOnlineService.ts`, `on-call/route.ts` | ✅ |

**Nhưng chưa dùng được.** Sáu lỗi dưới đây, hai cái đầu là chặn cứng.

---

## 3. P0-1 — Không ai bấm được gì: `allow_on_call` vẫn `false` toàn bộ

`plans/prompt_fix_type_d_allow_on_call.md` **chưa được làm**. Tôi vừa query lại DB:

```
T027 T021 T002 T001 T069 T025 T079 T011 T016 T018 NH079 T014
→ allow_on_call = false, đủ 12/12
```

Và `lib/constants/staff.constants.ts:27` vẫn `allow_on_call: false` — nguồn mặc định thứ hai, dùng khi **tạo nhân viên mới** (`app/admin/employees/actions.ts:133`). Chỉ sửa `KtvFeatures.logic.ts:113` là chưa đủ, vì hàm đó chỉ chạy khi admin **đổi loại** cho một người.

Làm đúng 3 việc trong file plan đó: gom một nguồn mặc định duy nhất → sửa `staff.constants.ts` → script backfill merge cờ cho 12 người (**merge, không ghi đè cả object** — họ đang mang `tua_wallet`, `bonus_wallet`, `internal_fund_enabled`, `withdraw_morning_only`).

---

## 4. P0-2 — Vào lại sau tan ca là MẤT SẠCH SỐ TUA đã làm trong ngày

`lib/services/KtvTypeDOnlineService.ts`, cuối `arriveAtVenue()`:

```ts
await supabase.from('TurnQueue').upsert({
    employee_id: staffId,
    date: businessDateStr,
    queue_position: nextPosition,
    check_in_order: nextCheckIn,
    status: 'waiting',
    turns_completed: 0,          // ⚠️ ĐÂY
}, { onConflict: 'employee_id,date' });
```

`TurnQueue` UNIQUE `(employee_id, date)`. Lần check-in thứ hai trong ngày rơi vào nhánh **conflict → UPDATE**, và `turns_completed: 0` **ghi đè số tua đã làm về 0**.

Đúng ngay kịch bản anh mô tả: *"làm tua và bấm tan ca, sau đó vẫn muốn làm nữa"*. Vào lại phát thứ hai là sổ tua về 0 — sai tua, sai lương, sai thứ tự xếp hàng.

Sửa: đọc record hiện có trước.

- **Đã có record trong ngày** → chỉ `update({ status: 'waiting' })`. Giữ nguyên `turns_completed`, `queue_position`, `check_in_order`.
- **Chưa có** → insert như hiện tại.

Không dùng `upsert` cho việc này nữa — upsert với cột đếm tích lũy là sai về bản chất.

> `KtvOnlineService.arriveAtVenue` của Loại B dính **đúng lỗi này**. Nhưng đợt này **không sửa file của B** — ghi vào mục risk, tôi mở phiếu riêng cho B.

---

## 5. P1-1 — Giờ rảnh chưa tự tính theo đúng yêu cầu

Yêu cầu: KTV **chỉ chọn số phút di chuyển**, hệ thống tự lấy `giờ hiện tại + số phút` ra giờ rảnh, rồi màn Điều Phối hiện khung giờ đó.

Hiện tại `AttendanceTypeD.tsx:268` vẫn có ô nhập tay **"Giờ rảnh dự kiến"** (`expectedStart`), và `type-d/on-call/route.ts:147` chỉ tự tính khi ô đó **rỗng**:

```ts
let availableFromStr = expected_start;          // ← KTV nhập gì thì lấy nấy
if (!availableFromStr) { /* now + travel */ }
```

→ KTV gõ tay là đè mất công thức. Sai contract.

Sửa:

- **Bỏ hẳn ô "Giờ rảnh dự kiến"** khỏi popup của D. Thay bằng dòng xem trước read-only, cập nhật theo `tempMins`:
  *"Bạn sẽ rảnh lúc: **19:45** (bây giờ 19:15 + 30 phút)"*
- Giữ ô **"Đến mấy giờ?"** (`expectedEnd`) — đó là KTV tự quyết, mặc định `now + 4h` nếu bỏ trống.
- Client **không gửi `expected_start`** nữa. Backend luôn tự tính `available_from = now(VN) + travel_minutes`, **bỏ đường nhận `expected_start` từ payload** — backend không tin payload.
- Kiểm tra vắt qua nửa đêm: 23:50 + 30 phút phải ra `00:20`, không phải `24:20`.

Đối chiếu màn Điều Phối `DispatchOnlineKtvTable.tsx` đã hiện sẵn `Khung giờ: {available_from} - {available_until}` và `+{travel_minutes} phút` — không cần sửa, chỉ cần dữ liệu vào đúng.

---

## 6. P1-2 — Lệch ngày giữa `businessDate` và `vnToday()` → phạt oan -10 giờ

Ba chỗ code mới tra `KTVTypeDDailyRegistration` bằng **Business Date** (trừ `spa_day_cutoff_hours` = 6h):

- `app/api/ktv/type-d/on-call/route.ts:39` (`isOffToday`)
- `KtvTypeDOnlineService.goOnline` (chặn ngày OFF)
- `KtvTypeDOnlineService.arriveAtVenue` (ghi `check_in_at`)

Nhưng bảng đó được **ghi** theo `vnToday()` — ngày lịch VN, không trừ cutoff:

- `app/api/ktv/daily-registration/route.ts`
- `app/api/ktv/attendance/route.ts` Step 0.6 (chính anti vừa viết, dùng `vnToday()`)

→ Trong khung **00:00–06:00**, đọc ngày hôm qua, ghi ngày hôm nay. Hậu quả nặng nhất: `arriveAtVenue` không tìm thấy record nên **không ghi `check_in_at`**, rồi cron `daily-absence-check` thấy `check_in_at` rỗng → `deductDailyViolation('ABSENT_NO_NOTICE')` = **trừ 10 giờ công của người đi làm thật**.

Sửa: mọi truy vấn `KTVTypeDDailyRegistration` dùng `vnToday()` từ `lib/vn-time`. `businessDate` chỉ giữ cho `TurnQueue` và `KTVShifts` — hai bảng đó đúng là theo Business Date.

---

## 7. P1-3 — Ngày OFF làm mất nút tan ca → KTV kẹt

`AttendanceTypeD.tsx:103` early-return cả màn hình khi `isOffToday`, đặt **trước** mọi nhánh trạng thái. KTV đang `AT_VENUE` (đã Oria Xin chào, đang làm) mà bản ghi ngày chuyển `OFF_REGISTERED` — hoặc chỉ dính lệch ngày ở §6 — sẽ **mất luôn nút "Oria Xin cảm ơn"**, không tan ca được, phải nhờ admin sửa DB.

Sửa: `isOffToday` chỉ khoá **hai nút vào việc** trong nhánh `isOffline`. Nhánh `isAtVenue` **luôn** giữ nút tan ca. Banner "Hôm nay bạn đã đăng ký nghỉ" hiện phía trên, không thay thế cả màn hình.

---

## 8. P2 — Cron của Loại B đang quét cả Loại D

`KtvOnlineService.cleanupExpiredOnline` (gọi từ `app/api/cron/auto-offline/route.ts` và `app/api/cron/cleanup-online/route.ts`) select **mọi** `Staff` có `online_status='ONLINE'`, không lọc `work_type`.

Hiện tại tác động nhẹ (nó chỉ batch update bảng `Staff`, không đụng `TurnQueue`/`KTVShifts`), nên **đừng sửa vội**. Việc cần làm ở đợt này: xác nhận D hết `available_until` thì bị đưa về OFFLINE đúng cách, và ghi rõ vào báo cáo rằng D đang phụ thuộc cron của B — để quyết định tách sau.

---

## 9. Thứ tự làm

1. §3 (`allow_on_call` + backfill) — không có bước này thì không test được gì.
2. §4 (`turns_completed`) — lỗi mất dữ liệu, ưu tiên hơn mọi thứ giao diện.
3. §6 (lệch ngày) — lỗi phạt oan tiền/giờ công.
4. §5 (giờ rảnh tự tính) — đúng contract nghiệp vụ.
5. §7 (nút tan ca) — chống kẹt.
6. §8 — chỉ khảo sát và báo cáo.

---

## 10. Cách verify

Trên tài khoản `NH079`, **trong giờ hành chính** (tránh lẫn với lỗi lệch ngày):

1. Backfill xong → mở app → thấy `ĐANG TẮT` + 2 nút, hết màn vàng.
2. `Bật Nhận Đơn`, để 30 phút → popup hiện "Bạn sẽ rảnh lúc HH:mm" khớp `giờ hiện tại + 30`. Xác nhận → DB `available_from` đúng giá trị đó, `online_status='ONLINE'`, `travel_minutes=30`.
3. Màn Điều Phối hiện `NH079` với `Khung giờ: <from> - <until>` và `+30 phút`.
4. Thử gọi thẳng API kèm `expected_start: "06:00"` bằng curl → backend **bỏ qua**, vẫn ghi `now + travel`.
5. Vào Wi-Fi spa → `Oria Xin chào` → `AT_VENUE`, `KTVShifts` `FREE/ACTIVE`, `TurnQueue` `waiting`, `check_in_at` có giá trị.
6. **Gán 2 tua cho KTV này, hoàn thành** → `TurnQueue.turns_completed = 2`. Ghi lại con số.
7. `Oria Xin cảm ơn` → `CHECKED_OUT`, `KTVShifts` `COMPLETED`, `online_status='OFFLINE'`.
8. Màn hình quay lại 2 nút. Bấm `Oria Xin chào` lần hai → **`turns_completed` VẪN LÀ 2**, không về 0. ← nghiệm thu chính của §4.
9. Tan ca lần hai, vào lần ba → vẫn đúng.
10. Ngoài Wi-Fi spa bấm `Oria Xin chào` → bị chặn IP, có dòng trong `SecurityAuditLogs`.
11. Đăng ký OFF hôm nay: 2 nút vào việc bị khoá; nhưng nếu đang `AT_VENUE` thì **nút tan ca vẫn còn** (§7).
12. Chỉnh giờ hệ thống về 01:30 (hoặc gọi thẳng hàm) → `isOffToday` và `check_in_at` tra **cùng một ngày** với `daily-registration` (§6).
13. **Hồi quy Loại B**: bật nhận đơn → tới tiệm → tan ca → bật lại, không đổi hành vi. Dán `git diff --stat` chứng minh `KtvOnlineService.ts`, `on-call/route.ts`, `AttendanceTypeB.tsx` không bị sửa.
14. `npx tsc --noEmit` sạch; `npm run test:type-d` xanh.

---

## 11. Output bắt buộc

- Log script backfill (12 dòng trước/sau) + query xác nhận các cờ khác còn nguyên.
- `grep -rn "allow_on_call" lib/ app/` chứng minh chỉ còn 1 nguồn mặc định.
- Ảnh/log DB của bước 6 → 8 (`turns_completed` trước và sau khi vào lại).
- Xác nhận `available_from` được tính ở backend, không nhận từ payload.
- Danh sách chỗ còn dùng `businessDate` cho `KTVTypeDDailyRegistration` (phải bằng 0).
- Risk còn treo: Loại B cũng dính lỗi `turns_completed` (§4) và cron dùng chung (§8).
