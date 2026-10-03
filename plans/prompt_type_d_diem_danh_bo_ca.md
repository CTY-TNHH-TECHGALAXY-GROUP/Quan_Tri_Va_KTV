# Prompt — Loại D điểm danh: bỏ chọn ca, chuyển sang bảng đăng ký ngày

> Copy toàn bộ phần dưới gửi cho anti. Áp dụng **ANTIGRAVITY MODE**.
> Trạng thái chung của Loại D: `plans/TYPE_D_MASTER.md`.

---

## 1. Hiện tượng

Modal **"ORIA XIN CHÀO"** của KTV **Loại D** đang hiện dropdown **"Ca làm việc hôm nay"** với giá trị `Ca 1 (09:00 - 17:00)`, kèm cảnh báo vàng *"Bạn đang điểm danh trễ — vui lòng nhập lý do"* và bắt nhập lý do trễ.

**Sai nghiệp vụ.** Loại D làm theo **cơ chế tự do**: đăng ký theo NGÀY qua màn Lịch (`KTVTypeDDailyRegistration`), **không có ca cố định**, nên:
- Không được hỏi chọn ca.
- Không được tính trễ theo giờ bắt đầu ca.
- Không được có lựa chọn "Nghỉ đột xuất" ở đây (Loại D có luồng đăng ký OFF riêng, hạn chót 19:00 hôm trước).

---

## 2. Đã chẩn đoán xong — KHÔNG cần đoán lại

### 2.1 Nguồn của dropdown
`app/ktv/attendance/page.tsx:772`

```tsx
{formType === 'CHECK_IN' && workType !== 'TYPE_B' && (
```

Điều kiện chỉ loại trừ `TYPE_B`. **Loại D lọt vào** → hiện selector ca.

### 2.2 Nguồn của giá trị "Ca 1"
`app/ktv/attendance/page.tsx:288-295`

```tsx
if (workType === 'TYPE_B') {
    setSelectedShiftType('VIP');
} else if (isOffToday) {
    setSelectedShiftType('FREE');
} else {
    setSelectedShiftType(activeShiftType || 'FREE');   // ← Loại D rơi vào đây
}
```

`activeShiftType` đến từ `app/api/ktv/shift/route.ts`, đọc bảng **`KTVShifts`** (ca cũ).
**File đó grep `TYPE_D` = 0 kết quả**, và có fallback cứng `|| 'SHIFT_1'` ở các dòng 131, 144, 159, 233. Đó là lý do ra `Ca 1 (09:00 - 17:00)`.

### 2.3 Nguồn của cảnh báo "điểm danh trễ"
`app/ktv/attendance/Attendance.logic.ts:248-291` — `checkIsLate()`

```tsx
if (user?.roleId === 'support' || workType === 'TYPE_B') { setIsLate(false); return false; }
...
if (activeShiftType === 'FREE' || 'REQUEST' || 'SUPPORT' || 'VIP') { setIsLate(false); return false; }
const startTimeStr = SHIFT_START_TIMES[activeShiftType];   // SHIFT_1 → '09:00'
```

Không có nhánh `TYPE_D` → Loại D bị tính trễ theo mốc **09:00 của Ca 1**, trong khi giờ đúng phải là `expected_time` mà KTV tự đăng ký.

### 2.4 Màn chấm công CHƯA dùng bảng đăng ký mới

`app/ktv/attendance/Attendance.logic.ts:113`

```tsx
if (statusRes.todayRegistration) setTodayRegistration(statusRes.todayRegistration);
```

Nhưng `app/api/ktv/attendance/status/route.ts` **không trả field `todayRegistration`** — cả 2 chỗ trả về (dòng **181** và **185**) chỉ có `checkStatus, record, workType, availableUntil, incompleteTasksCount, guestArrivalLock, lockInfo`.

→ `todayRegistration` **luôn `null`** → khối "Giờ bạn đã đăng ký" (`page.tsx:828-838`) **không bao giờ hiển thị**.

### 2.5 ⚠️ Server đang chặn ngày OFF — SAI LUẬT

**Luật đúng (chủ dự án chốt): KTV Loại D đã đăng ký OFF vẫn được đi làm.** Đăng ký OFF là để hệ thống biết trước mà không phạt vắng, **không phải lệnh cấm đến tiệm.**

Nhưng `app/api/ktv/attendance/route.ts:206-214` đang trả **403**:

```ts
if (registration && registration.status === 'OFF_REGISTERED') {
    return NextResponse.json({
        success: false,
        error: 'Bạn đã đăng ký nghỉ (OFF) hôm nay. Vui lòng hủy đăng ký trước khi điểm danh.'
    }, { status: 403 });
}
```

Và `AttendanceTypeD.tsx:119` cũng viết sai theo: *"Bạn không thể Oria Xin chào hoặc nhận đơn trong ngày nghỉ."*

**Hiện tại hai lỗi đang che nhau**: server chặn (sai luật), client không biết vì `todayRegistration` null (2.4) nên vẫn cho bấm → KTV chụp ảnh, bấm Gửi, rồi **ăn 403 sau khi đã upload**. Sửa 2.4 mà không sửa 2.5 thì sẽ thành chặn ngay từ giao diện — **sai nặng hơn**. Phải sửa cùng lúc.

> Đối chiếu: với A/B/C, `page.tsx:290-292` đã ghi rõ *"Ngày OFF mà vẫn lên làm → luôn tính là Ca tự do"*. Loại D phải theo cùng tinh thần đó.

### 2.6 Rủi ro ghi đè ca
`app/api/ktv/attendance/route.ts:384-410`: nếu client gửi `selectedShiftType`, route sẽ **ghi đè `KTVShifts.shiftType`**. Với Loại D, nếu gửi `SHIFT_1` lên thì sẽ **phá ca `FREE/ACTIVE`** mà `KtvTypeDOnlineService` dựa vào để mở/đóng ca (kết quả đã chốt ở on-call đợt 5).

---

## 3. VIỆC PHẢI LÀM

### 3.1 API trả `todayRegistration` (làm TRƯỚC, mấy phần sau phụ thuộc)

`app/api/ktv/attendance/status/route.ts` — khi `workType === 'TYPE_D'`, query:

```ts
const { data: todayRegistration } = await supabase
  .from('KTVTypeDDailyRegistration')
  .select('status, expected_time, check_in_at, penalty_applied')
  .eq('staff_id', <mã KTV>)
  .eq('work_date', <ngày làm việc theo business date>)
  .maybeSingle();
```

Thêm `todayRegistration` vào **CẢ HAI** `NextResponse.json` (dòng 181 và 185). Với loại khác trả `null`.

> Lấy đúng `staff_id` và cách tính business date theo `app/api/ktv/type-d/on-call/route.ts:38` — chỗ đó đã làm đúng, **dùng lại, đừng tự chế**.

### 3.2 Ẩn hẳn selector ca cho Loại D

`page.tsx:772` đổi điều kiện thành loại trừ cả D:

```tsx
{formType === 'CHECK_IN' && workType !== 'TYPE_B' && workType !== 'TYPE_D' && (
```

Thay vào đó, với Loại D hiển thị **khối chỉ-đọc**: giờ đã đăng ký lấy từ `todayRegistration.expected_time` (khối `page.tsx:828-838` đã có sẵn — chỉ cần đưa ra ngoài nhánh vừa ẩn để nó vẫn hiện với D). Nếu chưa đăng ký thì hiện dòng nhắc "Hôm nay bạn chưa đăng ký đi làm".

### 3.3 Không gửi `selectedShiftType` cho Loại D

`page.tsx:288-295` — thêm nhánh:

```tsx
} else if (workType === 'TYPE_D') {
    setSelectedShiftType('');      // hoặc 'FREE' — xem §4 câu hỏi 1
}
```

Và `Attendance.logic.ts:444` đảm bảo Loại D gửi lên `selectedShiftType: null`, để `route.ts:384` không chạy nhánh ghi đè ca.

### 3.4 Loại D không bao giờ tính trễ theo ca

`Attendance.logic.ts:249` thêm `TYPE_D` vào điều kiện thoát sớm:

```tsx
if (user?.roleId === 'support' || workType === 'TYPE_B' || workType === 'TYPE_D') {
    setIsLate(false);
    return false;
}
```

> Trễ của Loại D **không tính ở client**. Việc so `check_in_at` với `expected_time` và áp kỷ luật đã có ở `app/api/cron/daily-absence-check/route.ts` — **đó là nơi duy nhất được quyết định trễ/vắng**. Đừng viết thêm logic trễ ở màn chấm công.

### 3.5 Bỏ lựa chọn "Nghỉ đột xuất" khỏi luồng D
Đi kèm 3.2 (ẩn cả select là xong). Kiểm tra thêm `page.tsx:842` và `:974` — các điều kiện đang so `selectedShiftType !== 'SUDDEN_OFF'`; xác nhận với D (giá trị rỗng) chúng vẫn chạy đúng, không làm nút Gửi bị khoá vĩnh viễn.

### 3.6 Ngày OFF vẫn phải đi làm được — GỠ chặn, đổi thành thông báo

Đây là phần sửa **luật**, không phải sửa giao diện. Làm đủ 3 chỗ:

**a) Gỡ chặn server** — `app/api/ktv/attendance/route.ts:206-214`: **xoá** khối trả `403` khi `status === 'OFF_REGISTERED'`. KTV Loại D đã đăng ký OFF **vẫn được điểm danh**.

**b) Sửa lời cảnh báo** — `AttendanceTypeD.tsx:117-119`: đổi từ *"Bạn không thể Oria Xin chào hoặc nhận đơn trong ngày nghỉ"* thành thông báo **không chặn**, đại ý: *"Hôm nay bạn đã đăng ký nghỉ. Vẫn đi làm được — hệ thống sẽ ghi nhận là đi làm."* Giữ nguyên màu vàng, **không disable nút nào**.

**c) Không để `isOffToday` biến thành khoá** — sau khi 3.1 xong, `Attendance.logic.ts:458` sẽ cho `isOffToday = true` với D đăng ký OFF. **Rà toàn bộ chỗ đọc `isOffToday`** trong `page.tsx` và `AttendanceTypeD.tsx`, đảm bảo nó chỉ dùng để **hiển thị**, không dùng để `disabled` nút hay chặn submit.

> ⚠️ Đây là điểm dễ làm hỏng nhất của cả đợt: sửa 3.1 mà quên 3.6 sẽ biến lỗi hiện tại (chặn muộn, sau khi upload ảnh) thành chặn ngay từ giao diện. **Phải sửa cùng một lần.**

---

## 4. Cần chốt trước khi code

1. Loại D điểm danh xong thì `KTVShifts` ghi ca gì? Theo on-call đợt 5, `arriveAtVenue` tạo ca `FREE/ACTIVE` — **màn chấm công có nên đụng vào `KTVShifts` nữa không, hay để `KtvTypeDOnlineService` lo hết?** Nếu để service lo thì 3.3 phải gửi `null`, không phải `'FREE'`.
2. KTV Loại D **chưa đăng ký hôm nay** mà bấm Oria Xin chào thì: chặn hẳn, hay cho vào và ghi nhận là "đi làm không đăng ký" để cron phạt?
3. **Liên quan 3.6** — KTV đăng ký OFF nhưng vẫn đi làm thì bản ghi `KTVTypeDDailyRegistration` xử lý thế nào?
   - (a) Giữ nguyên `OFF_REGISTERED`, chỉ ghi thêm `check_in_at`; hay
   - (b) Tự chuyển sang `REGISTERED` / một status mới kiểu `OFF_BUT_WORKED`?

   Câu này ảnh hưởng `app/api/cron/daily-absence-check/route.ts` — nếu để (a) thì phải chắc cron **không** phạt vắng người đã có `check_in_at`. Mở file đó ra xác nhận trước khi chọn.

Chưa có câu trả lời thì **hỏi trước, đừng tự quyết**.

---

## 5. KHÔNG ĐƯỢC LÀM

- Không đụng luồng của TYPE_A / TYPE_B / TYPE_C. `page.tsx:772` và `Attendance.logic.ts:249` là **code dùng chung** — chỉ được thêm nhánh loại trừ D, không đổi hành vi loại khác.
- Không sửa `app/api/ktv/shift/route.ts` để nhét TYPE_D vào. Loại D **không dùng bảng ca**.
- Không thêm logic tính trễ mới ở client (xem 3.4).
- Không đổi tên / cấu trúc `KTVTypeDDailyRegistration`.

---

## 6. Nghiệm thu — chạy thật, dán output

Test trên tài khoản Loại D thật (T079 / NH079), có snapshot + restore:

1. **Chưa đăng ký** → mở Oria Xin chào: **không** có dropdown ca, **không** có cảnh báo trễ, hiện dòng nhắc chưa đăng ký.
2. **Đã đăng ký `REGISTERED`, `expected_time = 14:00`**, bấm lúc 15:00 → **không** hiện cảnh báo trễ, khối "Giờ bạn đã đăng ký: 14:00" **hiện đúng**.
3. **Đã đăng ký `OFF_REGISTERED`** → **vẫn Oria Xin chào được bình thường**. Hiện thông báo vàng "vẫn đi làm được", nút Gửi **không** bị khoá, API trả `success: true`. **Dán response thật** — đây là chỗ trước đây trả 403.
4. Kiểm tra `KTVShifts` của KTV đó sau khi điểm danh: **không** có bản ghi `shiftType = 'SHIFT_1'` mới sinh ra.
5. **Hồi quy A/B/C**: 1 KTV TYPE_A và 1 TYPE_B điểm danh — dropdown ca, cảnh báo trễ, nút Gửi hoạt động **y như trước**.
6. `npx tsc --noEmit` sạch **và** `npm run build` chạy được. Build đã từng fail ở các đợt trước — **phải chạy thật, không suy đoán**.

Báo kết quả thật kể cả khi fail. Không báo xong khi chưa verify.
