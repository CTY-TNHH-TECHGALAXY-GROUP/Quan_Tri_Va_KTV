# Đợt 5 — Hoàn tác đợt 4: tiền đề "đóng ca khi tan ca" là SAI

> Prompt gửi cho anti. Nối tiếp `plans/prompt_type_d_oncall_dot4.md`. Áp dụng **ANTIGRAVITY MODE**.

---

## 1. Đọc phần này trước, đừng sửa gì cho tới khi hiểu

Plan đợt 4 do tôi viết **dựa trên một tiền đề sai**. Anti làm đúng theo plan, lỗi là của plan. Đợt này hoàn tác phần sai, giữ lại phần đúng.

Tiền đề sai: *"tan ca thì phải đóng ca — `KTVShifts.status` phải chuyển `COMPLETED`"*.

Sự thật: **`KTVShifts` không ghi lại buổi làm việc. Nó ghi lại BẢN PHÂN CA.**

### Hợp đồng thật của `KTVShifts.status`

| Giá trị | Nghĩa |
|---|---|
| `ACTIVE` | Bản phân ca **đang có hiệu lực** của KTV này |
| `REPLACED` | Bản phân ca cũ, đã bị bản mới thay thế |
| `PENDING` / `APPROVED` / `REJECTED` | Yêu cầu đổi ca chờ duyệt (luồng khác) |

- `effectiveFrom` = **"có hiệu lực TỪ ngày"**, không phải "ca của riêng ngày đó". Một ca `SHIFT_1` với `effectiveFrom = 2026-06-23` vẫn đang là ca hiện hành của KTV đó hôm nay.
- Mỗi KTV chỉ có **đúng 1 dòng `ACTIVE`** tại một thời điểm. Đó là trạng thái đúng, không phải rác.
- **Không có khái niệm "đóng ca".** KTV tan ca thì bản phân ca của họ vẫn còn hiệu lực cho ngày mai.

### Bằng chứng đo được trên DB thật

```
Toàn bộ KTVShifts:  REPLACED 368  |  ACTIVE 17  |  COMPLETED 0
```

**Không một bản ghi `COMPLETED` nào trong toàn bộ lịch sử hệ thống.** Câu `status:'COMPLETED'` chưa bao giờ chạy thành công — vì luôn bị lỗi `actualEndTime` chặn lại. Nói cách khác: **lỗi `actualEndTime` suốt mấy tháng qua đang vô tình che chắn cho một đường code phá hoại.** Đợt 4 vừa gỡ tấm chắn đó ra.

17 dòng `ACTIVE` hiện tại = 13 `"Khôi phục ca gốc sau điểm danh"` + 4 `"Admin gán ca"`, mỗi KTV đúng 1 dòng. **Bảng đang khoẻ.**

### Vì sao `COMPLETED` sẽ phá luồng điểm danh

Cả 2 nơi đọc ca đều lọc:

```ts
app/api/ktv/shift/route.ts:96,201        .in('status', ['ACTIVE', 'REPLACED'])
app/api/finance/payroll/shifts/route.ts:26  .in('status', ['ACTIVE', 'REPLACED'])
```

`COMPLETED` **không nằm trong danh sách** → ca bị set `COMPLETED` sẽ **biến mất khỏi cả API ca làm việc lẫn bảng lương**. Dây chuyền:

1. KTV Loại A tan ca → mọi ca `ACTIVE` của họ thành `COMPLETED`
2. Hôm sau mở app → `/api/ktv/shift` không thấy ca nào
3. `shiftFetchError = true` → màn điểm danh báo *"Không tải được ca làm việc"*, **nút Gửi bị khoá** → KTV không điểm danh được
4. Ca đó cũng rơi khỏi bảng lương

### Ca tạm đã tự dọn, không cần script

`app/api/ktv/shift/route.ts:120-147` có sẵn cơ chế: ca có `reason === 'Tự chọn ca lúc điểm danh'` mà quá ngày thì tự chuyển `REPLACED` và tạo lại ca gốc `ACTIVE` với reason `"Khôi phục ca gốc sau điểm danh"`.

Kiểm chứng: 3 dòng ca tạm trong dry run của anti (T079, dev, T016) **giờ đã tự chuyển `REPLACED`** mà không ai làm gì. Hệ thống tự lành.

---

## 2. Việc phải làm

### 2.1. Bỏ hẳn câu update "đóng ca" ở 2 nhánh tan ca

`app/api/ktv/attendance/route.ts` — **xoá cả khối**, không chỉ xoá field:

| Vị trí | Khối cần xoá |
|---|---|
| nhánh **D** tan ca (~347) | `supabase.from('KTVShifts').update({ status: 'COMPLETED', reason: ... })` |
| nhánh **A** tan ca (~491) | khối y hệt |

Giữ nguyên mọi thứ khác trong 2 nhánh đó (`Users.isOnShift`, `TurnQueue`, `KtvTypeDOnlineService.goOffline`...).

Sau khi xoá, hành vi trở về đúng như trước đợt 4 — chỉ khác là giờ nó **cố tình không làm gì**, thay vì làm mà thất bại trong im lặng. Ghi comment rõ lý do ngay tại chỗ để người sau không "sửa lại":

```ts
// KHÔNG đóng KTVShifts ở đây. Bảng này lưu BẢN PHÂN CA, không lưu buổi làm việc.
// status ACTIVE = phân ca đang hiệu lực, phải giữ qua ngày.
// Set COMPLETED sẽ làm ca biến mất khỏi /api/ktv/shift và bảng lương
// (cả hai đều lọc .in('status', ['ACTIVE','REPLACED'])).
```

### 2.2. Xoá script dọn dẹp

Xoá `scripts/cleanup_stuck_active_shifts.ts`. **Chưa từng chạy `--execute`, và không được chạy.**

14/17 dòng nó nhắm tới là ca cố định hiện hành của NH001, NH002, NH007, NH011, NH014, NH016, NH018, NH021, NH025, NH027, NH069, NH079. Chạy nó = xoá phân ca của 12 KTV thật.

### 2.3. Bỏ phần ghi đè `reason`

Đợt 4 thêm `reason: 'System closed at check-out'` vào các câu update. Plan đợt 4 đã ghi *"giữ nguyên `status` và `reason`"* — chỗ này làm sai.

Cột `reason` đang mang thông tin thật (`"Admin gán ca"`, `"Tự chọn ca lúc điểm danh"`, `"Khôi phục ca gốc sau điểm danh"`) và **chính `shift/route.ts:122` dùng nó để phân biệt ca tạm với ca cố định**. Ghi đè `reason` = phá luôn cơ chế tự dọn ca tạm.

Rà mọi câu ghi `KTVShifts` mới thêm trong đợt 4: **không câu nào được ghi `reason`** trừ khi đang `insert` một bản ghi mới.

### 2.4. Thu hẹp phạm vi 2 câu update trong `KtvTypeDOnlineService`

Hai câu này đang set `REPLACED` cho **mọi** ca `ACTIVE` có `effectiveFrom = hôm nay`:

- `arriveAtVenue` — replace ca cũ trước khi mở ca `FREE` mới
- `goOffline` — đóng ca khi D tắt nhận đơn

Nếu admin vừa gán ca cho một KTV Loại D **trong hôm nay**, hai câu này sẽ xoá mất bản phân ca đó.

Thu hẹp: chỉ đụng đúng ca do chính service này tạo ra —

```ts
.eq('reason', 'KTV Loại D tới tiệm')
```

thêm vào cả hai câu, bên cạnh các điều kiện sẵn có.

### 2.5. GIỮ NGUYÊN — phần đợt 4 làm đúng

- Toàn bộ phần **bắt lỗi** cho các thao tác `KTVShifts` (5 chỗ). Đây là việc tốt nhất của đợt 4: chính nhờ tư duy này mà lớp lỗi im lặng mới lộ ra.
- Việc bỏ `actualEndTime` khỏi `KtvTypeDOnlineService.goOffline` — câu đó vẫn cần chạy (để đóng ca `FREE` do chính nó tạo), chỉ cần thêm điều kiện ở §2.4.
- Không thêm cột `actualEndTime` vào DB.

---

## 3. Loại B — anh Hiếu đã quyết: ĐỂ ĐỢT SAU

Không đụng `lib/services/KtvOnlineService.ts` trong đợt này. Ba lỗi của B (`staffCode` dòng 128, 180; `actualEndTime` dòng 132) vẫn để nguyên.

Ghi chú quan trọng cho đợt xử lý B sau này: **lỗi `actualEndTime` ở dòng 132 của B đang đóng vai tấm chắn giống hệt trường hợp A/D.** Khi nào sửa cho B thì phải xử lý cùng lúc với việc rà lại xem `REPLACED` có đúng ngữ nghĩa cho ca `VIP` của B không — đừng sửa lẻ một dòng.

---

## 4. Không được đụng

- `app/api/ktv/shift/route.ts` — cơ chế tự dọn ca tạm và khôi phục ca gốc đang chạy đúng.
- `SHIFT_END_TIMES` / `canCheckOut` trong `Attendance.logic.ts`.
- `actualEndTime` của **segment booking** (`handleFinishService.ts`, `handleGetBooking.ts`, `handleStartTimer.ts`, `handleReleaseKTV.ts`, `KtvCommissionService.ts`, `KtvTypeDCommissionService.ts`, `BookingItemPauseService.ts`, `KtvDisciplineService.ts`) — khác hoàn toàn.
- `lib/services/KtvOnlineService.ts` (Loại B).
- Không tạo migration nào.

---

## 5. Cách verify

1. `grep -rn "COMPLETED" app/api/ktv/attendance/route.ts` → **0 kết quả** liên quan `KTVShifts`.
2. `ls scripts/cleanup_stuck_active_shifts.ts` → không tồn tại.
3. Query DB: số dòng `ACTIVE` vẫn là **17**, số `COMPLETED` vẫn là **0**. Không dòng nào bị đụng.
4. Trên **T079** (snapshot trước, restore sau):
   - `arriveAtVenue` → tạo ca `FREE/ACTIVE` reason `"KTV Loại D tới tiệm"`.
   - Tạo tay thêm 1 ca `ACTIVE` khác cho T079 với `effectiveFrom` = hôm nay, reason `"Admin gán ca"`.
   - Gọi `goOffline` → **chỉ** ca `"KTV Loại D tới tiệm"` chuyển `REPLACED`; ca `"Admin gán ca"` **phải còn nguyên `ACTIVE`**. ← nghiệm thu của §2.4.
   - Xoá ca tự tạo, restore T079.
5. Gọi API tan ca thật của một KTV Loại A trên môi trường test → bản phân ca của họ **vẫn `ACTIVE`** sau khi tan ca; hôm sau `/api/ktv/shift` vẫn trả đúng ca, không có `shiftFetchError`.
6. Kiểm `reason`: sau mọi thao tác tan ca / tắt nhận đơn, cột `reason` của các bản ghi cũ **không bị đổi**.
7. `npx tsc --noEmit` sạch; `npm run test:type-d` xanh.
8. Hồi quy đợt 2–3: gán 2 tua → tan ca → vào lại → `turns_completed` vẫn 2, ca `FREE` mới được mở.

---

## 6. Output bắt buộc

- Diff của 2 khối đã xoá ở `attendance/route.ts`, kèm comment giải thích tại chỗ.
- Xác nhận đã xoá script và **chưa từng chạy `--execute`**.
- Query DB chứng minh: `ACTIVE = 17`, `COMPLETED = 0`, không dòng nào bị sửa.
- Log bước 4 (ca `"Admin gán ca"` sống sót qua `goOffline`).
- Danh sách các câu ghi `KTVShifts` còn ghi `reason` — phải chỉ còn ở các câu `insert`.
- Xác nhận không đụng file của Loại B.
- Risk còn treo: 3 lỗi của Loại B; cron `auto-offline`/`cleanup-online` dùng chung cho cả D; lỗi `turns_completed` bên `KtvOnlineService.arriveAtVenue`.

---

## 7. Bài học ghi lại cho các đợt sau

Trước khi "sửa" một câu ghi DB đang thất bại, phải trả lời được: **câu đó nếu chạy thành công thì hệ thống có đúng hơn không?** Ở đây câu trả lời là *không* — nó chưa từng chạy trong suốt lịch sử hệ thống, và mọi bên đọc dữ liệu đều được thiết kế trên giả định nó không chạy. Một câu lệnh chết lâu năm là dấu hiệu cần đọc lại thiết kế, không phải dấu hiệu cần vá.
