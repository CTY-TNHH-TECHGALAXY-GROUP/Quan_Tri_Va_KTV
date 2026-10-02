# Prompt — Sửa Phase 1 (đợt 1): hạng mục B thiếu `KtvAssignments`, hạng mục C test lệch chỗ

> Copy toàn bộ phần dưới gửi cho anti.
> Bổ sung cho `plans/prompt_bit_lo_hong_van_hanh_phase1.md` và `plans/prompt_bit_lo_hong_phase1_bo_sung_B.md`.

---

Đã review code trên nhánh `feat/bit-lo-hong-phase1`. **Làm đúng nhiều thứ:**

- Đứng đúng nhánh riêng, `package.json` chỉ thêm đúng 1 dòng `test:race`, không đụng file của luồng khác ✅
- Hạng mục B — cả 3 filter (dòng 104 / 308 / 578) đã thêm `SPLIT` ✅
- Khối `SPLIT_GUARD` đặt **đúng vị trí**: dòng 115, **trước** AUTO-ACTIVATE ASSIGNMENT (dòng 158) ✅
- Realtime dashboard xử lý `SPLIT` mà **vẫn giữ nguyên rào hậu kỳ** `REVIEW/HANDOVER/REWARD` ✅
- Script test có `finally` dọn sạch dữ liệu test ✅
- `npx tsc --noEmit` sạch ✅

Còn **3 việc** phải xong trước khi commit.

---

## V1 — `SPLIT_GUARD` bỏ quên `KtvAssignments`, KTV sẽ kẹt assignment vĩnh viễn ⛔ NẶNG NHẤT

Guard hiện chỉ dọn `TurnQueue` (dòng 144 và 147). `KtvAssignments` **không được đụng đến** — đúng phần đã dặn ở `prompt_bit_lo_hong_phase1_bo_sung_B.md` §3 mục 2 và 3.

### Vì sao đây là lỗi thật, không phải lo xa

Ở nhánh chuyển hướng, dòng 143 gán `bookingId = foundChildId`, nhưng hàng `KtvAssignments` vẫn mang `booking_id` = **đơn cha**. Mà `app/api/ktv/booking/_handlers/handleReleaseKTV.ts:115` đóng assignment bằng:

```
.eq('booking_id', bookingId)   // giờ là mã đơn CON
```

→ không khớp hàng nào → **assignment kẹt `QUEUED` vĩnh viễn** sau khi KTV làm xong tua.

Cùng lý do, khối AUTO-ACTIVATE ASSIGNMENT (dòng 158-175) cũng tra theo `booking_id` → trả `null` → bỏ qua kích hoạt hoàn toàn.

### Phải sửa

**Nhánh chuyển hướng (dòng 141-144)** — ngoài `TurnQueue`, thêm:

```
UPDATE "KtvAssignments"
SET booking_id = <foundChildId>
WHERE employee_id = <technicianCode>
  AND business_date = <getBusinessDate()>
  AND booking_id = <mã đơn cha>
  AND status IN ('QUEUED','READY','ACTIVE')
```

Chỉ đụng đúng `employee_id` + `business_date` hiện tại. **Không** được update theo mỗi `booking_id` — sẽ đá nhầm assignment của KTV khác trên cùng đơn cha.

**Nhánh đá văng (dòng 145-155)** — ngoài `TurnQueue`, thêm:

```
UPDATE "KtvAssignments"
SET status = 'CANCELLED', updated_at = now()
WHERE employee_id = <technicianCode>
  AND business_date = <getBusinessDate()>
  AND booking_id = <mã đơn cha>
  AND status IN ('QUEUED','READY','ACTIVE')
```

Để nguyên `QUEUED` trên một đơn cha đã chết là rác treo trong DB, và `promote_next_assignment` vẫn nhìn thấy nó.

---

## V2 — Test hạng mục C không chạm vào lớp chống race chính

Script đang gọi thẳng `handleFinishService(ctx)`. Spec yêu cầu đi qua **`PATCH /api/ktv/booking`**. Khác biệt này làm hỏng cả 3 kịch bản:

| Kịch bản | Vấn đề |
|---|---|
| 1 | `select` ra `handover_images` nhưng **không assert**. Mà ảnh bàn giao được ghi ở `handleReleaseKTV`, **không phải** `handleFinishService` → vế *"quầy chốt hóa đơn trước, KTV vẫn up ảnh được"* — tức lỗ hổng 4.2 cần chứng minh — **chưa được kiểm chứng dòng nào** |
| 2 | Đạt, giữ nguyên |
| 3 | Chỉ đang test smart-status **cấp item**, không phải 2 KTV đua nhau **cấp booking** |

Và quan trọng nhất: **Safety Recompute** (`app/api/ktv/booking/route.ts:146-176`) — lớp chống race condition chính — nằm ở orchestrator, **không nằm trong handler**. Gọi thẳng handler là bỏ qua hoàn toàn lớp này.

### Phải sửa

- Đổi cả 3 kịch bản sang gọi HTTP thật: `PATCH http://localhost:3000/api/ktv/booking` với body `{ bookingId, status, action, techCode, photosBase64 }`. Server phải đang chạy (`npm run dev`) khi chạy test — ghi rõ điều kiện này vào comment đầu file.
- **Kịch bản 1**: assert thêm `handover_images` **có dữ liệu** sau khi gọi với `action: 'RELEASE_KTV'` + `photosBase64`, và `handover_status = 'PENDING'`. Đây mới đúng là điều lỗ hổng 4.2 cần chứng minh.
- **Kịch bản 3**: sau khi KTV thứ nhất bấm xong, assert thêm **status của Booking** (không chỉ của item) không bị đẩy lên `DONE` khi còn item `IN_PROGRESS` — đó mới là chỗ Safety Recompute làm việc.

---

## V3 — Chạy test và dán output

Chưa thấy bằng chứng đã chạy lần nào. Sau khi sửa V1 + V2:

- `npm run test:race` → **dán nguyên output**, kể cả khi fail.
- `npm run test:type-d` → phải vẫn xanh (chứng minh không phá luồng TYPE_D đang chạy song song).
- `npx tsc --noEmit` → sạch.

---

## Nghiệm thu bắt buộc cho V1 — dán SQL thật

Dựng ca kẹt thật: **điều phối đơn xong → KTV CHƯA bấm bắt đầu → lễ tân tách đơn**. (KTV đã bấm bắt đầu rồi thì item `IN_PROGRESS` đã mang `bookingId` đơn con, nhánh 1.a tự khỏi — không tái hiện được lỗi.)

Sau khi KTV mở app, dán kết quả 2 câu:

```sql
SELECT current_order_id FROM "TurnQueue"
WHERE employee_id='<mã KTV>' AND date='<ngày>';

SELECT booking_id, status FROM "KtvAssignments"
WHERE employee_id='<mã KTV>' AND business_date='<ngày>';
```

- Ca **có đơn con**: cả hai phải trỏ sang mã **đơn con**, assignment còn `QUEUED/READY/ACTIVE`.
- Ca **không có đơn con**: `TurnQueue.current_order_id` = `null`, `KtvAssignments.status` = `CANCELLED`.
- Ca **KTV đã bấm bắt đầu** rồi mới bị tách: chạy bình thường, guard mới **không** được đá nhầm.
- Ca KTV đang ở màn `HANDOVER` mà đơn bị tách: **không** bị đá ra.

---

## Ghi chú nhỏ (làm luôn nếu tiện, không bắt buộc)

- Guard đang bắn thêm 1 `SELECT Bookings` cho **mọi** request, kể cả đơn thường. File này từng có commit tối ưu perf (`e34c869 debug(Perf): thêm timing logs cho API GET booking`). Nếu gộp được vào lần fetch sẵn có ở bước 3 thì gộp; không gộp được thì thôi, đừng đục thêm.
- Dòng 137 `foundChildId = childItems[0].bookingId` — lấy phần tử đầu không sắp xếp. KTV có item ở 2 đơn con thì kết quả tuỳ hứng. Thêm `.order('timeStart')` hoặc chọn theo item đang `IN_PROGRESS` trước.

---

## Commit

Chưa commit gì cả — sau khi 3 việc trên xong và test xanh thì commit, tách 2 commit riêng cho B và C:

- `feat(ops): chan don cha SPLIT o app KTV va dong bo KtvAssignments`
- `test(ops): them test hoi quy race condition handover qua route PATCH`

Nhắc lại luật cũ: `git add` liệt kê tường minh từng file, **cấm `git add -A` / `git add .`** — working tree đang có sẵn file rác và file `plans/`, `scripts/` untracked **của luồng khác**, commit hộ là hỏng việc người ta.

Hạng mục **A (khóa nút Tan ca)** vẫn giữ nguyên: chưa làm, chờ chủ dự án chốt 4 câu ở §7 prompt gốc.
