# Đợt 3 — KTV Loại D nhận đơn: sửa lỗi P0 không mở được ca

> Prompt gửi cho anti. Nối tiếp `plans/prompt_type_d_oncall_dot2.md`. Áp dụng **ANTIGRAVITY MODE**.

---

## 1. Đợt 2 đã nghiệm thu — trừ một lỗi mới

Tôi đã kiểm chứng độc lập toàn bộ đợt 2, **chạy thật trên T079 và NH079** qua `KtvTypeDOnlineService` (đúng đường của D, không đụng service B), có snapshot và restore đầy đủ.

Đạt:

| Hạng mục | Bằng chứng runtime |
|---|---|
| §3 Gom cờ + backfill | 12/12 `allow_on_call=true`, các cờ khác nguyên vẹn; `staff.constants.ts` là nguồn duy nhất |
| §4 Không mất tua | gán 2 tua → tan ca → vào lại → `turns_completed = 2`, `queue_position` giữ nguyên (T079: 9, NH079: 13) |
| §5 Giờ rảnh tự tính | `travel=25` lúc 22:25 → `available_from = 22:50:00`, `travel_minutes = 25` |
| §6 `vnToday()` | đúng bảng, `businessDate` chỉ còn ở `TurnQueue`/`KTVShifts` |
| §7 Banner OFF | nhánh `isAtVenue` không bị chặn, nút tan ca còn |
| Không đụng B | `KtvOnlineService.ts`, `on-call/route.ts` sạch |

`tsc --noEmit` sạch, `npm run test:type-d` xanh 4/4.

**Nhưng phát hiện một lỗi P0 do chính đợt refactor này gây ra.**

---

## 2. P0 — Check-in của Loại D KHÔNG mở ca `KTVShifts`, và hàm vẫn báo thành công

### Bằng chứng

NH079 trước test có **0** record `KTVShifts` hôm nay. Sau khi `arriveAtVenue` chạy **thành công 2 lần**, vẫn **0**. `Users.isOnShift` không đổi. T079 giữ nguyên 1 record cũ, không có record mới, cũng không có record nào bị chuyển `REPLACED`.

### Nguyên nhân

`lib/services/KtvTypeDOnlineService.ts` dòng **119** và **163**:

```ts
const { data: user } = await supabase.from('Users').select('id').eq('staffCode', staffId).maybeSingle();
```

Query thẳng DB trả về:

```
error: column Users.staffCode does not exist

Cột thật của Users:
id, username, password, code, fullName, gender, isOnShift, isBusy,
createdAt, googleId, permissions, role, auth_user_id
```

**Cột đúng là `code`.** Query lỗi → `user` = `null` → toàn bộ khối `if (user) { ... }` bị bỏ qua **im lặng**, nhưng hàm vẫn `return { success: true }`.

Mất theo đó:

- `arriveAtVenue`: không `REPLACED` ca cũ, **không insert `KTVShifts` `FREE/ACTIVE`**, không set `isOnShift = true`.
- `goOffline`: không đóng ca `ACTIVE`, không set `isOnShift = false`.

### Vì sao là regression của đợt này

Trước refactor, nhánh check-in của D trong `attendance/route.ts` tạo `KTVShifts` **trực tiếp** bằng `employeeId` (chính là `Users.id`) nên chạy đúng. Khi chuyển sang gọi `arriveAtVenue`, code copy từ service của B đã mang theo tên cột sai. Đây đúng là kiểu lỗi antigravity nhắm tới: đổi layer mà không kiểm chứng contract ở layer dưới.

### Việc phải làm

1. Sửa `staffCode` → `code` tại `KtvTypeDOnlineService.ts:119` và `:163`.
2. **Không nuốt lỗi nữa.** Cả hai chỗ phải lấy cả `error` và xử lý:
   - Query lỗi → `return { success: false, error }`, đừng đi tiếp.
   - Không tìm thấy `Users` cho `staffId` → đó là dữ liệu hỏng, phải `console.error` rõ ràng và trả lỗi, không được lặng lẽ bỏ qua khối ghi ca.
3. Rà toàn repo: chỉ còn **2 chỗ** dùng `Users.staffCode` là `lib/services/KtvOnlineService.ts:128` và `:180` (của Loại B) — **giữ nguyên**, ghi vào mục risk. Tôi mở phiếu riêng cho B.

---

## 3. P1 — Ghi dở dang rồi trả lỗi, không có transaction

Khi tôi chạy lần đầu, `arriveAtVenue` ném lỗi ở đoạn cuối (ghi `check_in_at`). Lúc đó nó **đã kịp ghi** `Staff = AT_VENUE` và `TurnQueue`, rồi vẫn trả `{ success: false }`. Mà `attendance/route.ts` nhánh D thấy `!res.success` là trả **500** cho KTV.

Kết quả: KTV thấy màn báo lỗi, trong khi trạng thái trong DB đã đổi rồi. Bấm lại thì trạng thái đã là `AT_VENUE`.

Nguyên nhân cụ thể của lần đó là môi trường test của tôi thiếu path alias, không xảy ra trên Next.js. **Nhưng bất kỳ lỗi nào ở đoạn cuối cũng cho ra đúng tình trạng này** — đây là vấn đề thiết kế, không phải sự cố một lần.

Việc phải làm — chọn một, nói rõ chọn cái nào và vì sao:

- **(a)** Sắp lại thứ tự ghi: những gì có thể hỏng đặt lên trước, `Staff.online_status` ghi **sau cùng** — để trạng thái hiển thị luôn là thứ chốt hạ.
- **(b)** Bọc phần ghi `check_in_at` trong `try/catch` riêng, log lỗi nhưng **không** làm hỏng kết quả trả về (nó là bản ghi phụ, không phải điều kiện để KTV vào ca).
- **(c)** Gom thành một RPC/transaction trong Postgres.

Tôi nghiêng về **(b) + (a)**: nhẹ, không đổi kiến trúc, và đúng bản chất — `check_in_at` hỏng thì không đáng để chặn KTV vào ca. Nhưng nếu chọn (b) thì **phải** log đủ để phát hiện, vì `check_in_at` rỗng sẽ khiến cron `daily-absence-check` phạt 10 giờ.

---

## 4. P2 — Hai thứ còn sót từ đợt 2

### 4.1. `expected_start` là dữ liệu chết

`app/api/ktv/type-d/on-call/route.ts:59` vẫn destructure `expected_start`, và dòng **92** vẫn ghi nó vào `feature_flags`. Nó không còn ảnh hưởng `available_from` nữa (đã tự tính ở backend, đúng), nhưng để lại sẽ khiến người đọc sau tưởng nó còn tác dụng.

Bỏ khỏi cả destructure lẫn `newFlags`.

### 4.2. Preview lệch múi giờ

`AttendanceTypeD.tsx:106` `getPreviewTime()` dùng `new Date()` = **giờ máy KTV**, trong khi backend tính theo `Asia/Ho_Chi_Minh`. Máy đặt sai múi giờ thì con số KTV nhìn thấy khác con số thực ghi vào DB.

Sửa: tính preview theo VN giống backend.

---

## 5. Không được đụng

- `lib/services/KtvOnlineService.ts`, `app/api/ktv/on-call/route.ts`, `app/ktv/attendance/_components/AttendanceTypeB.tsx`.
- Nhánh `isTypeB` trong `app/api/ktv/attendance/route.ts`.
- Nhánh A/B/C trong `resolveAttendanceStatus.ts`.

---

## 6. Cách verify — chạy thật, không kết luận suông

Trên **T079** (tài khoản test), snapshot trước và restore sau:

1. Xoá/ghi nhận số `KTVShifts` hiện có của hôm nay. Gọi `arriveAtVenue`.
2. **Phải có thêm 1 record `KTVShifts`**: `shiftType='FREE'`, `status='ACTIVE'`, `effectiveFrom` = business date, `reason='KTV Loại D tới tiệm'`. Ca `ACTIVE` cũ (nếu có) phải chuyển `REPLACED`.
3. `Users.isOnShift = true`.
4. Gọi `goOffline` → ca vừa tạo chuyển `REPLACED` + có `actualEndTime`, `isOnShift = false`.
5. Lặp lại kịch bản đợt 2 để chắc không vỡ: gán 2 tua → tan ca → vào lại → `turns_completed` **vẫn là 2**, `queue_position` không đổi.
6. Thử với một `staffId` không có trong `Users` → hàm phải trả `success: false` với thông báo rõ, **không** được trả `success: true`.
7. Kiểm §3: cố tình làm bước ghi `check_in_at` hỏng (đổi tạm tên bảng) → KTV vẫn vào ca được, có log lỗi, và hàm trả kết quả nhất quán với trạng thái DB.
8. Bỏ `expected_start`: gọi API kèm `expected_start: "06:00"` → không xuất hiện trong `feature_flags`, `available_from` vẫn là `now + travel`.
9. `npx tsc --noEmit` sạch; `npm run test:type-d` xanh.
10. `git diff --stat` chứng minh 3 file của Loại B không bị sửa.

**Restore T079 về đúng snapshot ban đầu sau khi test xong** — Staff, TurnQueue, KTVShifts, isOnShift.

---

## 7. Output bắt buộc

- Log DB bước 1→4: số `KTVShifts` trước/sau, nội dung record mới, `isOnShift` trước/sau.
- Log bước 5 (`turns_completed` trước/sau).
- Log bước 6 (trường hợp không tìm thấy `Users`).
- Nói rõ đã chọn phương án (a)/(b)/(c) ở §3 và vì sao.
- `grep -rn "staffCode" lib/ app/ | grep Users` — phải chỉ còn đúng 2 dòng của Loại B.
- Xác nhận đã restore T079.
- Risk còn treo: Loại B dính cùng lỗi `Users.staffCode` (`KtvOnlineService.ts:128,180`) và lỗi `turns_completed`; cron `auto-offline`/`cleanup-online` dùng chung cho cả D.
