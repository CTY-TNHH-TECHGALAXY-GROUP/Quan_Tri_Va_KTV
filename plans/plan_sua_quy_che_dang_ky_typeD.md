# Plan: Sửa quy chế đăng ký / kỷ luật TYPE_D theo mô tả nghiệp vụ mới

**Ngày lập:** 2026-09-03
**Trạng thái code hiện tại:** đã khảo sát qua 2 script mô phỏng (`scratchpad/simulate_typed_registration.ts`, `scratchpad/simulate_user_scenarios.ts`). Kết quả: **4 khớp / 5 lệch** so với mô tả nghiệp vụ.

---

## 1. Bối cảnh & nguồn gốc

Người dùng mô tả quy chế mong muốn:

1. Sau 23:59 ngày D mà KTV không đăng ký gì (không OFF, không LÀM) → **khóa tài khoản**.
2. Đã đăng ký LÀM ngày D+1 → **trước 07:00 sáng ngày D+1** vẫn được đổi giờ hoặc chuyển sang OFF, không bị ảnh hưởng gì.
3. Sau 07:00 ngày D+1 nếu chưa sửa → chỉ còn được **báo trễ 1 lần duy nhất** + chọn giờ đến. Nếu đến trễ hơn giờ đã báo trễ → **-5h**.
   *(Ghi chú: trước 07:00 đổi giờ có mặt thoải mái qua endpoint `daily-registration`; sau 07:00 chỉ còn quyền BÁO TRỄ 1 lần, không được đổi giờ báo trễ.)*
4. Đã đăng ký LÀM nhưng OFF luôn không đăng nhập → sau 23:59 ngày D+1 **khóa app**.
5. Đã đăng ký OFF → trước 07:00 vẫn có thể đổi thành LÀM và chọn giờ.
6. Ngày OFF vẫn cho KTV đến tiệm điểm danh đi làm bình thường (upgrade OFF → LÀM).

## 2. Lệch giữa mong muốn và code hiện tại

| # | Kịch bản | Code hiện tại | File / dòng |
|---|---|---|---|
| A | Không đăng ký + không đi làm → KHÓA | ✅ khớp | [daily-absence-check/route.ts:71-91](app/api/cron/daily-absence-check/route.ts) |
| B | Sáng cùng ngày (< 07:00) sửa lịch | ❌ chặn | [vn-time.ts:34](lib/vn-time.ts) `canEditRegistration` |
| C | Sau 07:00 báo trễ 1 lần | ✅ khớp | [attendance-adjustment/route.ts:74-81](app/api/ktv/attendance-adjustment/route.ts) |
| D | Trễ hơn giờ đã báo trễ → -5h | ❌ chưa có | Cần thêm mới |
| E | Đăng ký LÀM mà off luôn → KHÓA | ❌ chỉ phạt -10h | [daily-absence-check/route.ts:98-135](app/api/cron/daily-absence-check/route.ts) |
| F | OFF → chuyển LÀM trước 07:00 | ❌ chặn | Cùng bug #B |
| G | Ngày OFF vẫn đến tiệm check-in | ❌ chặn (deadlock với #F) | [attendance/route.ts:210-215](app/api/ktv/attendance/route.ts) |

## 3. Mục tiêu

Đưa hành vi hệ thống về đúng 6 quy tắc mô tả trong §1, đồng thời:
- Loại bỏ deadlock giữa "sửa lịch trong ngày" và "check-in khi đang OFF".
- Tái sinh `LATE_NO_UPDATE` (-5h) đang là dead code — dùng đúng cho tình huống "trễ hơn giờ đã báo trễ".
- Đơn giản hóa nhánh cron sau 07:00 (không còn nhánh chết).

## 4. Thay đổi cần thực hiện

### 4.1. Nới `canEditRegistration` — [lib/vn-time.ts:34](lib/vn-time.ts)

Cho sửa lịch ngày D khi hiện đang là chính ngày D **và giờ VN < 07:00**.

```ts
// Trước
export function canEditRegistration(workDateStr: string): boolean {
  return workDateStr > vnToday();
}

// Sau
export function canEditRegistration(workDateStr: string): boolean {
  const today = vnToday();
  if (workDateStr > today) return true;
  if (workDateStr === today && vnHour() < 7) return true;
  return false;
}
```

**Ảnh hưởng call-site:**
- [app/api/ktv/daily-registration/route.ts:54](app/api/ktv/daily-registration/route.ts) — tự động nhận rule mới.
- [app/ktv/schedule/page.tsx](app/ktv/schedule/page.tsx) — 4 call-site UI (dòng 125, 247, 359, 446) sẽ tự cho phép edit ô hôm nay trước 07:00. Cần verify UI vẫn render đúng nhãn (không hiện "đã khóa" khi giờ VN 06:xx).

### 4.2. Bỏ chặn CHECK_IN khi OFF_REGISTERED (cả backend + frontend)

**a. Backend** — [attendance/route.ts:210-215](app/api/ktv/attendance/route.ts):

Thay vì reject, **tự động upgrade** registration từ `OFF_REGISTERED` → `REGISTERED` khi KTV check-in trong ngày.

```ts
// Trước
if (registration && registration.status === 'OFF_REGISTERED') {
  return NextResponse.json({ success: false, error: '...' }, { status: 403 });
}

// Sau
if (registration && registration.status === 'OFF_REGISTERED') {
  await supabase.from('KTVTypeDDailyRegistration')
    .update({ status: 'REGISTERED', expected_time: format(vnNow(), 'HH:mm') })
    .eq('id', registration.id);
}
```

**b. Frontend** — 3 điểm phải sửa (hiện đang chặn UI dù backend đã cho qua):

- [AttendanceTypeD.tsx:114-122](app/ktv/attendance/_components/AttendanceTypeD.tsx) — banner "Hôm nay bạn đã đăng ký nghỉ / Bạn không thể Oria Xin chào hoặc nhận đơn": **đổi text** thành thông báo nhẹ "Bạn đã đăng ký nghỉ hôm nay. Nếu đổi ý, bấm bật nhận đơn để đi làm bình thường." Bỏ ý "không thể".
- [AttendanceTypeD.tsx:154, :178](app/ktv/attendance/_components/AttendanceTypeD.tsx) — bỏ điều kiện `!state?.isOffToday` ở nhánh render nút vào việc; bỏ `disabled={... state?.isOffToday}` ở nút "Oria Xin chào" / "Bật nhận đơn".
- [attendance/page.tsx:292](app/ktv/attendance/page.tsx) — nhánh `else if (isOffToday)` hiện chuyển hướng sang REPORT_ABSENT / block submit. **Bỏ nhánh này** — cho check-in đi thẳng, backend sẽ tự upgrade.
- [attendance/page.tsx:790, :817](app/ktv/attendance/page.tsx) — điều chỉnh render nút / option để không ẩn khi `isOffToday`; giữ nguyên các guard khác (activeShiftType, workType).

Rationale: quy tắc §1.6 — ngày OFF vẫn cho đến tiệm làm. Không cần thao tác hủy trước. UI chặn (đặc biệt banner "Bạn không thể…") là gốc gây khiếu nại KTV thấy.

**Vấn đề đang xảy ra thực tế (2026-09-03):** KTV chụp màn hình báo lỗi — nút "ĐANG TẮT" không bấm được vì `isOffToday=true`, banner vàng đỏ chặn cứng, không có cách bật nhận đơn dù đã đến tiệm. Đây là bằng chứng bug đã ảnh hưởng vận hành, ưu tiên fix trước.

### 4.3. Đổi cron: REGISTERED không đi làm → LOCK — [daily-absence-check/route.ts:98-135](app/api/cron/daily-absence-check/route.ts)

Nhánh "có đăng ký nhưng không check-in":

| Trạng thái đăng ký | Có báo vắng trước 07:00? | Xử lý mới |
|---|---|---|
| `REGISTERED` (không báo gì) | — | **KHÓA TÀI KHOẢN** (thay vì -10h) |
| `ABSENT_REPORTED` (đã báo vắng) | Có (< 07:00) | -5h ABSENT_EARLY_NOTICE |
| `LATE_REPORTED` (đã báo trễ) + không đến | — | **KHÓA TÀI KHOẢN** (giống REGISTERED-không-đến, vì hứa trễ mà lặn luôn) |

Bỏ hoàn toàn nhánh `ABSENT_NO_NOTICE = -10h` cho case "bỏ lịch": nay đã escalate lên khóa tài khoản.
Giữ `ABSENT_NO_NOTICE` chỉ như penalty type dự phòng — không được cron tự phát nữa.

Cắt luôn nhánh chết `absentHour >= 7` (endpoint đã chặn báo vắng ≥07:00).

**Pseudo-code mới:**

```ts
if (!registration) {
  if (!hasAttendance) { LOCK(); continue; }  // §1.1
  continue; // quên đăng ký nhưng có đi làm
}

if (registration.status === 'OFF_REGISTERED') { markCompleted(); continue; }
if (registration.check_in_at || hasAttendance) { markCompleted(); continue; }

// Không đi làm
if (registration.status === 'ABSENT_REPORTED' && registration.absent_reported_at) {
  await deductDailyViolation(staff.id, todayStr, 'ABSENT_EARLY_NOTICE');
  markCompleted();
  continue;
}

// REGISTERED hoặc LATE_REPORTED mà lặn luôn → khóa
LOCK();  // §1.4
```

### 4.4. Thêm logic phạt "trễ hơn giờ đã báo trễ" — mới, gắn vào [attendance/route.ts](app/api/ktv/attendance/route.ts)

Khi KTV check-in (`CHECK_IN` hoặc `LATE_CHECKIN`) và là TYPE_D:

```ts
if (registration?.status === 'LATE_REPORTED' && registration.late_expected_time) {
  const [h, m] = registration.late_expected_time.split(':').map(Number);
  const expectedMinutes = h * 60 + m;
  const actualMinutes = vnNow().getHours() * 60 + vnNow().getMinutes();
  if (actualMinutes > expectedMinutes) {
    await KtvTypeDDisciplineService.deductDailyViolation(
      supabase, staffCode, today, 'LATE_NO_UPDATE',
      `Trễ hơn giờ đã báo trễ (${registration.late_expected_time})`
    );
  }
}
```

Tái sinh `LATE_NO_UPDATE` (-5h) — không còn dead code. Đây là bản duy nhất phạt trễ; không đụng đến case "đăng ký gốc nhưng đến trễ" (case đó không phạt, chỉ bị mất giờ tích lũy do vào ca muộn).

**Chốt nghiệp vụ về số lần / thời điểm cập nhật giờ (2026-09-03):**
- **Trước 07:00 sáng ngày D:** đổi `expected_time` không giới hạn qua endpoint `daily-registration` (nhờ §4.1 đã nới `canEditRegistration`).
- **Sau 07:00 sáng ngày D:** chỉ còn được bấm **BÁO TRỄ 1 lần duy nhất** qua `attendance-adjustment` (giữ nguyên rule `late_report_count >= 1` hiện có). Không có endpoint update `late_expected_time` sau khi đã báo trễ.
- **Deadline báo trễ:** phải bấm khi thời gian hiện tại còn trước `expected_time` (giờ đã đăng ký gốc). Nếu đã qua giờ đăng ký gốc mà chưa check-in cũng chưa báo trễ → không cho báo trễ nữa, coi như bỏ lịch → cron cuối ngày sẽ **KHÓA** (§4.3).

→ Bổ sung validate ở endpoint `REPORT_LATE` ([attendance-adjustment/route.ts:74](app/api/ktv/attendance-adjustment/route.ts)):

```ts
// Chặn báo trễ khi đã qua giờ đăng ký gốc
const now = vnNow();
const [regH, regM] = (registration.expected_time || '00:00').split(':').map(Number);
const regMinutes = regH * 60 + regM;
const nowMinutes = now.getHours() * 60 + now.getMinutes();
if (nowMinutes >= regMinutes) {
  return NextResponse.json({ error: 'Đã qua giờ đăng ký gốc, không thể báo trễ.' }, { status: 400 });
}

// Chặn báo trễ khi giờ hẹn trễ mới <= giờ hiện tại (báo trễ vô nghĩa)
const [lateH, lateM] = late_expected_time.split(':').map(Number);
const lateMinutes = lateH * 60 + lateM;
if (lateMinutes <= nowMinutes) {
  return NextResponse.json({ error: 'Giờ hẹn trễ phải sau thời điểm hiện tại.' }, { status: 400 });
}
```

### 4.5. Không thay đổi

- Endpoint `REPORT_ABSENT` giữ nguyên gate `hour < 7`.
- Endpoint `REPORT_LATE` giữ nguyên `late_report_count >= 1` chặn báo trễ lần 2. **Bổ sung 2 validate mới**: chặn báo trễ khi đã qua giờ đăng ký gốc; chặn khi `late_expected_time <= now` (xem §4.4).
- `ORDER_REJECT` giữ nguyên (-3× giờ dịch vụ).
- `SUDDEN_OFF` giữ nguyên (phụ thuộc feature flag).

## 5. Thứ tự triển khai

1. **§4.2** Bỏ chặn CHECK_IN khi OFF (backend + frontend) — **ƯU TIÊN 1** vì đang chặn KTV thực tế (bằng chứng screenshot).
2. **§4.1** `canEditRegistration` — 1 file, thấp rủi ro. Chạy sim `simulate_user_scenarios.ts` sau khi sửa để verify #2 và #6 chuyển sang ✅.
3. **§4.4** Thêm phạt "trễ-của-trễ" — 1 file, cần test unit cho service (đã có `simulate_type_d_discipline.ts` làm nền).
4. **§4.3** Đổi cron LOCK — **rủi ro cao nhất** vì escalate mức phạt. Cần:
   - Backup DB.
   - Test dry-run trên staging: mô phỏng 5-10 registration `REGISTERED` không check-in, kiểm tra tất cả bị LOCK đúng.
   - Thông báo KTV trước 1 tuần trước khi rollout.

## 6. Test bổ sung

Sau mỗi bước, chạy lại `scratchpad/simulate_user_scenarios.ts`. Kỳ vọng cuối: **8/8 khớp**.

Thêm test tích hợp DB (mở rộng `simulate_type_d_discipline.ts`):

- Case OFF → CHECK_IN: verify record được update thành `REGISTERED`, có `expected_time`.
- Case LATE_REPORTED trễ vs đúng giờ hẹn: verify chỉ record trễ hơn bị `LATE_NO_UPDATE`.
- Case REGISTERED không check-in: verify Staff.status = `KHÓA_TÀI_KHOẢN`, không có row `KTVServiceHoursLedger` -10h nào phát sinh.

## 7. Rủi ro & mitigation

| Rủi ro | Mitigation |
|---|---|
| Escalate -10h → LOCK làm bùng khiếu nại | Thông báo KTV, giữ endpoint "kích hoạt lại tài khoản" đã có (phí 1-2tr theo quy chế) |
| Nới `canEditRegistration` tạo lỗ hổng cho KTV báo OFF phút chót để né phạt | Không — trước 07:00 là ranh giới an toàn (chưa vào ca); sau 07:00 vẫn khóa |
| Auto-upgrade OFF → REGISTERED khi check-in tạo `expected_time` = giờ hiện tại → có thể không khớp KPI | Chấp nhận: KTV tự chịu trách nhiệm khi đổi lịch đột xuất |
| Phạt "trễ-của-trễ" bị double-charge với các cơ chế khác | Kiểm tra idempotency: `LATE_NO_UPDATE` chỉ apply 1 lần/ngày do unique constraint `(staff_id, date, penalty_type, booking_id=null)` |

## 8. Cập nhật quy chế công khai

Sửa file `public/regulations/type-d.html`:

- **Mục 04** (đăng ký): thêm "Ngày làm việc: trước 07:00 vẫn có thể đổi giờ đến hoặc chuyển sang OFF. Sau 07:00 chỉ được báo trễ 1 lần."
- **Mục 04** (OFF): thêm "Đã đăng ký OFF vẫn có thể đến tiệm điểm danh đi làm bình thường — hệ thống tự chuyển sang trạng thái LÀM."
- **Mục 06** (kỷ luật): thêm dòng "Đăng ký làm mà không đến, không báo → **khóa tài khoản** (giống trường hợp không đăng ký gì)."
- **Mục 06** (kỷ luật): sửa dòng "Đến trễ không nhắn cập nhật → -5h" thành **"Đã báo trễ mà đến muộn hơn giờ đã báo → -5h."**

## 9. Kiểm tra sau rollout

Ngày 1-7 sau deploy:
- Query `SecurityAuditLogs WHERE event_type='AUTO_LOCK_ABSENCE'` — so với baseline tuần trước.
- Query `KTVServiceHoursLedger WHERE penalty_type='LATE_NO_UPDATE'` — verify có phát sinh (dead code đã sống lại).
- Query `KTVTypeDDailyRegistration` — verify không còn record bị `penalty_applied = 'ABSENT_NO_NOTICE'` từ cron (đã escalate lên LOCK).
