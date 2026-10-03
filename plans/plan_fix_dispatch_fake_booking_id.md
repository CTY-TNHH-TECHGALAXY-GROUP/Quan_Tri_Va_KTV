# Kế Hoạch: Sửa Lỗi Mất KTV & Mã Booking Ảo Khi Điều Phối Đơn Tách

## 1. Context

Lễ tân báo 3 hiện tượng khi phân lịch cho đơn có nhiều thẻ (tách "Làm nối tiếp" hoặc nhiều khách):

1. KTV nhận được push notification nhưng mở app KTV Dashboard thì màn hình trống trơn.
2. Bấm "Gửi" ở thẻ B thì KTV ở thẻ A bị gạch tên.
3. Bấm "Gửi" một lần nhưng chỉ 1 người nhận được thông báo.

Đã khảo sát code và xác minh nguyên nhân gốc bằng SQL/TypeScript thực tế (không suy đoán). Kết luận: **lỗi nằm ở việc Frontend sinh mã booking ảo `-A`/`-B` rồi truyền thẳng xuống RPC**, trong khi Database chưa bao giờ có bản ghi mang mã đó.

### 1.1. Cơ chế sinh mã ảo (đã xác minh)

`splitBookingItem` tạo một dòng `BookingItems` mới với `crypto.randomUUID()`, có kế thừa `guest_id` từ item gốc ([lib/services/BookingModificationService.ts:679-691](lib/services/BookingModificationService.ts:679)).

Nhưng khi map dữ liệu lên UI, [app/reception/dispatch/useDispatchBoard.logic.ts:357](app/reception/dispatch/useDispatchBoard.logic.ts:357) cố tình bỏ `guest_id` nếu đơn còn `pending`:

```ts
customerGroupId: dStatus === 'pending' ? undefined : (bi.guest_id || parsedOptions?.customerGroupId)
```

Đơn chưa điều phối (`pending`) — chính là lúc Lễ tân bấm Gửi lần đầu — sẽ có `customerGroupId === undefined` cho cả 2 item. Khi đó [page.tsx:1260](app/reception/dispatch/page.tsx:1260) fallback sang `svc.id`:

```ts
const groupId = svc.customerGroupId || svc.id;   // 2 UUID khác nhau → 2 nhóm
```

→ `groups.size > 1` → `splitPlan` được tạo → [page.tsx:1298-1302](app/reception/dispatch/page.tsx:1298) gắn hậu tố ảo:

```ts
bookingId: `${clonedOrder.parentBookingId || clonedOrder.id}-${plan.suffix}`
```

**Hệ quả:** "Làm nối tiếp" bị hiểu nhầm thành "Tách khách" và sinh mã ảo. Với đơn đã điều phối rồi thì `guest_id` tồn tại và giống nhau ở cả 2 item → gom 1 nhóm → không sinh mã ảo. Đây là lý do lỗi có vẻ "lúc có lúc không".

### 1.2. Mã ảo xuống DB gây 2 hậu quả (đã xác minh trong RPC)

`processDispatch` truyền thẳng chuỗi `'123-A'` vào RPC `dispatch_confirm_booking` ([app/reception/dispatch/actions.ts:699-709](app/reception/dispatch/actions.ts:699)). Trong [supabase/migrations/20260814170000_add_sub_booking_support.sql](supabase/migrations/20260814170000_add_sub_booking_support.sql):

- **Dòng 291-317**: `INSERT INTO "TurnQueue" (... "current_order_id" ...) VALUES (... p_booking_id ...)`. Cột này không có FK → lưu `'123-A'` im lặng. App KTV cầm mã này query bảng `Bookings` → không thấy → **màn hình trống trơn**. ✅ Khớp hiện tượng 1.
- **Dòng 414-422**: `UPDATE "Bookings" SET "status" = ... WHERE "id" = p_booking_id`. Với `'123-A'` lệnh này khớp **0 dòng**. Postgres KHÔNG coi đây là lỗi. RPC vẫn `RETURN json_build_object('success', true)` ở dòng 438. → **Đơn không bao giờ chuyển sang PREPARING nhưng Lễ tân thấy báo thành công.** Đây là silent failure, chưa từng được báo cáo, nguy hiểm hơn cả lỗi màn hình trống.

### 1.3. Đính chính: KTV bị mất KHÔNG phải do RPC xóa

Giả thuyết "SQL thẳng tay xóa KTV 1" là **sai**. Khối cleanup dòng 99-108 bị giới hạn hai lớp:

```sql
WHERE "booking_id" = p_booking_id
  AND "booking_item_id" = ANY(v_updated_item_ids)
```

Khi gửi thẻ B, `v_updated_item_ids = [Item2]`. KTV1 nằm trên Item1 → không lọt tập ứng viên xóa. Thêm nữa `booking_id` của KTV1 là `'123-A'`, không khớp `'123-B'`. **RPC không thể xóa KTV1.**

Điều thực sự xảy ra là **TurnQueue bị ghi đè**. Dòng 330-334, khi upsert cho KTV2:

```sql
"booking_item_ids" = (SELECT array_agg(DISTINCT elem->>'bookingItemId')
                      FROM jsonb_array_elements(p_staff_assignments) elem
                      WHERE elem->>'ktvId' = v_assignment->>'ktvId')
```

Mảng này được tính **chỉ từ payload lần gửi hiện tại**. Nếu cùng một KTV phục vụ item ở cả hai thẻ, lần gửi thẻ B sẽ ghi đè `booking_item_ids` thành `[Item2]`, làm mất Item1 khỏi hàng đợi của họ → UI hiển thị như bị "gạch tên". Cơ chế `otherServicesInGroup` ("keepalive", [page.tsx:1369](app/reception/dispatch/page.tsx:1369)) sinh ra để chống đúng việc này, nhưng bị mã ảo chia nhóm làm cho mù.

### 1.4. Hiện tượng "chỉ gửi được 1 người" — hành vi đúng theo yêu cầu

[page.tsx:1287](app/reception/dispatch/page.tsx:1287) giới hạn `targetSvcIds` theo `selectedSubOrder`, khiến [page.tsx:1326](app/reception/dispatch/page.tsx:1326) `continue` bỏ qua nhóm không được chọn. **Người dùng đã xác nhận đây là hành vi mong muốn**: bấm Gửi ở thẻ nào thì chỉ gửi thẻ đó. Yêu cầu duy nhất là không được làm mất KTV ở thẻ khác. → **Không sửa phần này.**

## 2. Nguyên Tắc Sửa

- **Mã ảo `-A`/`-B` chỉ tồn tại ở tầng UI**, tuyệt đối không xuống DB.
- **Không mở rộng keepalive ra toàn đơn.** Việc nhét KTV của thẻ khác vào `p_staff_assignments` sẽ khiến RPC dòng 184 `INSERT INTO "TurnLedger" (date, booking_id, employee_id)` ghi thêm một dòng cho KTV đó. UNIQUE là `(date, booking_id, employee_id)` nên `'123-A'` và `'123-B'` là hai dòng riêng → **KTV bị đếm 2 tua cho 1 lần làm** → sai sổ tua, sai hoa hồng, sai bonus. Đây là lỗi tài chính, phải tránh tuyệt đối.
- **Giữ nguyên hành vi gửi riêng từng thẻ.**
- **Không đụng `subOrders`, `bookingGroups`, hay luồng tách khách multi-guest.**

## 3. Các Thay Đổi

### 3.1. [MODIFY] `app/reception/dispatch/page.tsx` — Tách ID hiển thị khỏi ID gửi xuống DB

Mở rộng kiểu `dispatchPayloads` (khoảng [dòng 1289](app/reception/dispatch/page.tsx:1289)) thêm một field cho mã thật:

```ts
const dispatchPayloads: Array<{
    bookingId: string;      // mã ảo, chỉ dùng cho log/thông báo lỗi trên UI
    dbBookingId: string;    // 🆕 mã thật, dùng để gọi RPC
    itemUpdates: any[];
    mergedAssignments: any[];
    bedId?: string | null;
    roomName?: string | null;
}> = [];
```

Tại chỗ push payload ([dòng 1430-1436](app/reception/dispatch/page.tsx:1430)) bổ sung:

```ts
dispatchPayloads.push({
    bookingId: group.bookingId,
    dbBookingId: clonedOrder.parentBookingId || clonedOrder.id,   // 🆕
    ...
});
```

Tại vòng gọi API ([dòng 1440-1453](app/reception/dispatch/page.tsx:1440)) đổi tham số thứ nhất sang `payload.dbBookingId`, giữ `payload.bookingId` trong thông báo lỗi để Lễ tân vẫn nhận diện được thẻ nào lỗi.

> Lưu ý: `bookingGroups`, `splitPlan`, `subOrders` và toàn bộ logic render Kanban **giữ nguyên** — giao diện vẫn thấy thẻ A/B như cũ.

### 3.2. [MODIFY] `app/reception/dispatch/page.tsx` — Vá keepalive đúng phạm vi

Vấn đề còn lại sau 3.1: cùng một KTV làm item ở hai thẻ thì `booking_item_ids` vẫn bị ghi đè (mục 1.3). Cách vá an toàn là mở rộng keepalive **chỉ cho những KTV đã có mặt trong payload lần này**, tuyệt đối không thêm KTV mới.

Sửa [dòng 1369](app/reception/dispatch/page.tsx:1369):

```ts
// CŨ — bị mã ảo bó hẹp trong nhóm:
// const otherServicesInGroup = clonedOrder.services.filter(
//     s => group.svcIds.includes(s.id) && !groupTargetSvcIds.includes(s.id));

// MỚI — quét toàn đơn, NHƯNG chỉ giữ lại KTV đã nằm trong đợt gửi này:
const ktvsBeingDispatched = new Set(allStaffAssignments.map(a => a.ktvId));
const otherServicesInGroup = clonedOrder.services.filter(
    s => !groupTargetSvcIds.includes(s.id)
);
```

Và trong vòng lặp keepalive ([dòng 1370-1387](app/reception/dispatch/page.tsx:1370)) thêm điều kiện chặn ngay sau `if (!row.ktvId) continue;`:

```ts
if (!ktvsBeingDispatched.has(row.ktvId)) continue;   // 🆕 không kéo KTV lạ vào payload
```

**Vì sao an toàn:** KTV đã có trong `allStaffAssignments` nghĩa là họ đã được ghi `TurnLedger` cho booking này rồi; thêm item của họ không tạo dòng ledger mới (ON CONFLICT DO NOTHING, dòng 186). Nó chỉ giúp `array_agg` ở dòng 330 gom đủ item → `booking_item_ids` không bị cụt. KTV ở thẻ khác **không** bị kéo vào payload → không double-count tua.

### 3.3. [NEW] `supabase/migrations/20260830_add_dispatch_booking_guard.sql` — Chặn báo thành công giả

`CREATE OR REPLACE FUNCTION dispatch_confirm_booking(...)` giữ nguyên toàn bộ thân hàm hiện tại, chỉ chèn **một guard ngay sau khối guard SPLIT** (sau [dòng 82](supabase/migrations/20260814170000_add_sub_booking_support.sql:82)):

```sql
-- Guard: Đơn phải tồn tại thật. Chặn silent failure khi FE gửi mã ảo (-A/-B)
IF NOT EXISTS (SELECT 1 FROM "Bookings" WHERE "id" = p_booking_id) THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', format('Không tìm thấy đơn hàng có mã "%s". Vui lòng tải lại trang và thử lại.', p_booking_id)
    );
END IF;
```

Guard này chạy **trước** mọi ghi dữ liệu (trước cleanup, trước TurnLedger, trước TurnQueue), nên không có bút toán rác nào được tạo. Nó bảo vệ vĩnh viễn khỏi mọi nguyên nhân gây sai mã trong tương lai, không riêng bug này.

Migration chỉ `CREATE OR REPLACE` — không `DROP`, không đổi signature, không đụng bảng. An toàn khi deploy lên production đang chạy.

### 3.4. [NEW] `scripts/scan_orphan_dispatch_ids.mjs` — Script quét dữ liệu cũ (CHỈ ĐỌC)

Script **read-only**, không `UPDATE`/`DELETE`/`INSERT` bất kỳ dòng nào. Kết xuất báo cáo ra console + file `scan_orphan_report.json`:

1. **TurnQueue mồ côi**: `current_order_id` không tồn tại trong `Bookings.id`. Liệt kê `employee_id`, `date`, `current_order_id`, `booking_item_ids`.
2. **TurnLedger mồ côi**: `booking_id` không tồn tại trong `Bookings.id`. Đây là nhóm quan trọng nhất — **mỗi dòng mồ côi có thể là 1 tua tính dư**. Gom nhóm theo `employee_id` + tháng để ước lượng số tua và số tiền bị lệch.
3. **KtvAssignments mồ côi**: `booking_id` không tồn tại trong `Bookings.id`.
4. **Đơn kẹt trạng thái**: `Bookings` còn `status IN ('NEW','WAITING','pending')` nhưng đã có `KtvAssignments`/`TurnLedger` trỏ tới mã `id || '-' || suffix` — dấu hiệu của silent failure ở mục 1.2.

Với mỗi nhóm, in ra: tổng số dòng, khoảng thời gian ảnh hưởng (min/max date), danh sách KTV bị ảnh hưởng, và **ước lượng số tua chênh lệch**. Tham khảo cách kết nối Supabase từ các script sẵn có như `check_ledger.mjs`, `check_turnqueue.mjs`.

**Không vá dữ liệu ở bước này.** Sau khi bạn đọc báo cáo và quyết định, tôi sẽ viết migration vá riêng.

## 4. Kiểm Chứng (Verification)

### 4.1. Regression — luồng đơn thường (bắt buộc pass trước tiên)

- Đơn 1 khách, 1 dịch vụ, 1 KTV → bấm Gửi. Xác nhận: KTV nhận push, mở app thấy đơn, `Bookings.status = 'PREPARING'`, `TurnQueue.current_order_id` = mã thật.
- Đơn multi-guest thật (2 khách khác nhau, đã có `guest_id`) → gửi từng thẻ. Xác nhận `TurnLedger` chỉ có **đúng 1 dòng cho mỗi (KTV, booking)** — chạy:
  ```sql
  SELECT employee_id, booking_id, COUNT(*) FROM "TurnLedger"
  WHERE date = CURRENT_DATE GROUP BY 1,2 HAVING COUNT(*) > 1;
  ```
  Kết quả phải rỗng.

### 4.2. Kịch bản bug gốc — "Làm nối tiếp"

Tạo đơn mới (giữ trạng thái `pending`), 1 dịch vụ 120 phút, bấm "Làm Nối Tiếp" chia 60/60 cho KTV1 và KTV2.

1. Bấm Gửi ở thẻ A → KTV1 nhận push, mở app **thấy đơn** (không trống trơn).
2. Kiểm tra DB: `SELECT id, status FROM "Bookings" WHERE id = '<mã thật>'` → `status = 'PREPARING'` (trước fix sẽ vẫn là `NEW`).
3. Bấm Gửi ở thẻ B → KTV2 nhận push và mở app thấy đơn.
4. **Kiểm tra KTV1 không bị mất**: `SELECT * FROM "KtvAssignments" WHERE employee_id = '<KTV1>' AND business_date = CURRENT_DATE` → vẫn `status IN ('ACTIVE','QUEUED')`. UI thẻ A vẫn hiện tên KTV1.
5. `SELECT * FROM "TurnLedger" WHERE date = CURRENT_DATE AND booking_id = '<mã thật>'` → đúng **2 dòng** (KTV1, KTV2), không phải 4.

### 4.3. Kịch bản 1 KTV làm cả 2 thẻ (kiểm chứng fix 3.2)

Gán KTV1 cho item ở cả thẻ A và thẻ B → gửi thẻ B. Xác nhận:
```sql
SELECT employee_id, booking_item_ids FROM "TurnQueue"
WHERE employee_id = '<KTV1>' AND date = CURRENT_DATE;
```
→ `booking_item_ids` phải chứa **cả 2 item**, không bị cụt còn 1.

### 4.4. Guard RPC

Gọi thủ công với mã không tồn tại, xác nhận trả về `success: false` và **không** sinh dòng rác:
```sql
SELECT dispatch_confirm_booking('KHONG_TON_TAI', CURRENT_DATE, 'PREPARING', NULL, NULL, NULL, NULL, '[]'::jsonb, '[]'::jsonb);
SELECT COUNT(*) FROM "TurnLedger" WHERE booking_id = 'KHONG_TON_TAI';  -- phải = 0
```

### 4.5. Chạy script quét

```bash
node scripts/scan_orphan_dispatch_ids.mjs
```
Đọc `scan_orphan_report.json`, đối chiếu số tua nghi lệch với báo cáo hoa hồng thực tế của 1-2 KTV để xác nhận mức độ ảnh hưởng trước khi quyết định vá.

## 5. Thứ Tự Triển Khai

1. Viết script quét (3.4) và **chạy trước khi sửa gì** — chốt số liệu hiện trạng làm mốc so sánh.
2. Deploy migration guard (3.3). Chạy 4.4.
3. Sửa Frontend (3.1 + 3.2). Chạy 4.1 → 4.3.
4. Chạy lại script quét, xác nhận **không phát sinh dòng mồ côi mới**.
5. Báo cáo kết quả quét dữ liệu cũ để bạn quyết định phương án vá.

## 6. Phạm Vi Không Đụng Tới

- `bookingGroups`, `splitPlan`, `subOrders`, logic render Kanban — giữ nguyên hoàn toàn.
- Luồng tách bill / chia tua theo `guest_id` ([actions.ts:620-696](app/reception/dispatch/actions.ts:620)) — giữ nguyên.
- `KtvCommissionService`, `KtvWalletService` — không đụng.
- Không xóa/sửa bất kỳ dòng dữ liệu lịch sử nào trong bước này.
