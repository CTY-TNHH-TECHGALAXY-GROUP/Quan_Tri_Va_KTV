# Prompt bổ sung — Hạng mục B (đơn cha SPLIT), Phase 1

> Copy toàn bộ phần dưới gửi cho anti.
> **Bổ sung cho** `plans/prompt_bit_lo_hong_van_hanh_phase1.md` §3. File prompt gốc đã được cập nhật đồng bộ — nếu anti chưa bắt đầu code thì đọc thẳng file gốc là đủ, file này dành cho trường hợp đã gửi prompt trước đó rồi.

---

Bổ sung cho **hạng mục B**. Tôi kiểm tra lại git log và RPC tách đơn, phát hiện lỗ hổng **rộng hơn** mô tả ban đầu. Đọc trước khi code hạng mục B.

## 1. Xác nhận: hạng mục B chưa ai làm

Đã rà toàn bộ git log, **19 commit** liên quan split/tách đơn:

- `328eeee` "gui dieu phoi vao dung don con sau khi tach don" — chỉ sửa `app/reception/dispatch/page.tsx`, **phía lễ tân**.
- `4309477` "tự động tách đơn ảo (-A, -B)... cho KTV" — commit duy nhất đụng `handleGetBooking.ts` mà có chữ "tách", nhưng chỉ là **hậu tố hiển thị `billCode`** khi 1 đơn có nhiều nhóm khách. Không liên quan đơn cha `SPLIT` vật lý.
- **Không commit nào** đụng `app/ktv/*` hoặc `app/api/ktv/*` cho đơn cha.
- `grep -rn "SPLIT\|parent_booking_id\|parentBooking" app/ktv app/api/ktv` tại HEAD → **0 kết quả**.

## 2. Lỗ hổng rộng hơn: lệch HAI bảng, không phải một

RPC tách đơn `supabase/migrations/20260821165237_update_rpc_split_booking_vat.sql` làm đúng 2 việc:

- dòng 76-77: `UPDATE "BookingItems" SET "bookingId" = v_new_booking_id` → items **chuyển hết sang đơn con**
- dòng 136: `SET "status" = 'SPLIT'` → **đơn cha thành rỗng, không còn item nào**

`grep -n "TurnQueue\|KtvAssignments\|TurnLedger"` trong RPC này ra **0 kết quả** → RPC **không remap** ba bảng đó.

Nên sau khi tách một đơn **đã điều phối**, có **HAI** bảng cùng trỏ sai vào đơn cha rỗng:

| Bảng | Trạng thái sau khi tách | Nơi bị ảnh hưởng |
|---|---|---|
| `TurnQueue.current_order_id` | vẫn = mã đơn **cha** | `handleGetBooking.ts:98-112` (nhánh 1.b resolve bookingId) |
| `KtvAssignments.booking_id` | vẫn = mã đơn **cha**, status `QUEUED`/`READY` | `handleGetBooking.ts:118-175` (khối AUTO-ACTIVATE ASSIGNMENT tra theo `booking_id`) |

⚠️ **Vá mỗi `TurnQueue` là chưa đủ** — khối auto-activate vẫn sẽ kích hoạt assignment trên đơn cha rỗng.

**Ca kẹt thật** (dùng đúng ca này để test, đừng test ca khác rồi báo xong): **điều phối đơn xong → KTV CHƯA bấm bắt đầu → lễ tân tách đơn**.
Nếu KTV đã bấm bắt đầu trước khi tách thì item `IN_PROGRESS` đã mang `bookingId` của đơn con, nhánh 1.a (dòng 60-86) tự khỏi — không tái hiện được lỗi.

## 3. Sửa lại Lớp 2 của `SPLIT_GUARD`

Thay phần "Lớp 2 — remap" trong prompt gốc bằng bản dưới. Vị trí đặt khối vẫn như cũ: **sau dòng 113, TRƯỚC khối AUTO-ACTIVATE ASSIGNMENT** — thứ tự này bắt buộc, đặt sau là assignment đã kịp active trên đơn cha.

Nếu booking vừa resolve có `status='SPLIT'`:

1. **Tìm đơn con của chính KTV này**: `Bookings.parent_booking_id = <mã cha>`, có `BookingItems.technicianCodes` chứa `techCode`, status chưa `DONE/CANCELLED`.

2. **Có đơn con** → chuyển hướng sang đơn con, đồng thời dọn **cả hai** bảng lệch:
   - `TurnQueue.current_order_id` → mã đơn con (kèm `booking_item_id` / `booking_item_ids` tương ứng)
   - `KtvAssignments` của KTV này đang trỏ đơn cha (`status IN ('QUEUED','READY','ACTIVE')`) → đổi `booking_id` sang đơn con. Chỉ đụng assignment của **đúng `employee_id` + `business_date`** hiện tại, **không** đụng KTV khác.

3. **Không có đơn con** → đá văng:
   - `TurnQueue` → `current_order_id = null, booking_item_id = null, booking_item_ids = [], status = 'waiting'`
   - `KtvAssignments` đang trỏ đơn cha → `status = 'CANCELLED'` (đơn cha không còn tồn tại về mặt nghiệp vụ; để nguyên `QUEUED` là KTV kẹt vĩnh viễn)
   - `return NextResponse.json({ success: true, data: null })`

Log: `console.warn('🚫 [KTV] Đơn cha SPLIT: <mã cha> → <mã con | đá văng>')`.

## 4. ⛔ Không sửa RPC tách đơn

Đừng sửa RPC để nó tự remap `TurnQueue`/`KtvAssignments`. Đó là vùng của luồng dispatch, và repo đang có nhiều luồng chạy song song — sửa RPC dùng chung lúc này là rủi ro không đáng đổi. Phase 1 **chỉ tự chữa ở phía App KTV**. Nếu bạn cho rằng bắt buộc phải sửa tận gốc ở RPC thì **báo cáo, đừng tự làm**.

## 5. Nghiệm thu bổ sung cho hạng mục B

- [ ] Kịch bản kẹt thật: điều phối xong, **KTV chưa bấm bắt đầu**, lễ tân tách đơn → app nhảy đúng đơn con, không treo màn trắng
- [ ] Sau kịch bản trên, dán kết quả **2 câu SQL** chứng minh cả hai bảng đã hết trỏ vào đơn cha:
  - `SELECT current_order_id FROM "TurnQueue" WHERE employee_id='<mã KTV>' AND date='<ngày>';`
  - `SELECT booking_id, status FROM "KtvAssignments" WHERE employee_id='<mã KTV>' AND business_date='<ngày>';`
- [ ] Tách đơn mà KTV không thuộc đơn con nào → app về Dashboard, `TurnQueue` sạch, `KtvAssignments` về `CANCELLED`
- [ ] KTV **đã bấm bắt đầu** rồi mới bị tách đơn → vẫn chạy bình thường qua nhánh 1.a, **không** bị guard mới đá nhầm
- [ ] KTV đang ở màn `HANDOVER` mà đơn bị tách → **không** bị đá ra
- [ ] `GET /api/ktv/booking?bookingId=<mã đơn cha SPLIT>` → `data: null`, dán response
