# Kế hoạch sửa lỗi UI Điều phối (Dispatch Board)

Kế hoạch này giải quyết các triệu chứng lỗi hiển thị trên giao diện Lễ tân, được cập nhật theo "Bản thống nhất" (Vòng 3).
**Nguyên tắc thi công:** Làm từng điểm một, test xong mới làm tiếp.

## Điểm 2 TỔNG HỢP: Khối ảo nối tiếp dùng chung `svc.id` khiến các thẻ ghi đè lẫn nhau - ✅ Đã Xong (tại `page.tsx`)
- **Nguyên nhân gốc rễ (Hợp nhất NN3, NN4):** `dispatch-timeline.ts` chẻ 1 dịch vụ thành 2 thẻ UI nhưng vẫn giữ chung 1 mã `svc.id`. Khi `QuickDispatchTable` (của từng thẻ) lưu dữ liệu về, nó dùng `svc.id` làm khóa và ghi đè toàn bộ `staffList` lên đơn gốc. Thẻ nào lưu sau sẽ đè chết KTV của thẻ trước (NN4). Tương tự, nếu thẻ 1 sửa tên, tên đó cũng áp lên toàn bộ dịch vụ (NN3).
- **Giải pháp đã triển khai:** Đã áp dụng cơ chế "Ghi đè có phạm vi" (Scoped Overwrite) tại `page.tsx:2488`. Hàm merge bây giờ đối chiếu với `originalSubset` (những gì thẻ được giao):
  - **Với staffList:** Chỉ thay thế/xóa những dòng KTV thuộc quyền thẻ hiện tại quản lý. Các KTV thuộc thẻ khác (của `_splitTime` khác) được giữ nguyên vẹn (`unmanagedStaffs`).
  - **Với options.displayName:** Vẫn áp dụng chung cho toàn dịch vụ (vì về bản chất vẫn là 1 dịch vụ gốc).

## Điểm 3 (NN1 & NN2): Bệnh mất thẻ đơn do fallback nuốt lỗi - ✅ Đã Xong
- **Tình trạng:** Đã fix bằng fallback tìm thẻ theo baseId (`.startsWith()`). Thẻ không còn bị rơi về đơn cha khi mã phase bị lệch.

## Điểm 5 (NN6): Autosave nguy hiểm - ✅ Đã Xong
- **Tình trạng:** Đoạn code chết `onBlur` trong `DispatchServiceBlock` đã bị xóa bỏ.

## Điểm 4 (NN5): Sai lệch index của tên DV - 🚫 ĐÃ HỦY BỎ
- **Lý do hủy:** Khi thẻ được tách, số lượng KTV trên mỗi thẻ con chỉ còn 1 (idx luôn = 0). Lỗi lệch chỉ số (index shifting) chỉ xảy ra khi một thẻ có nhiều KTV và user xóa KTV ở giữa. Do thiết kế chia tách thẻ nối tiếp đã ngăn ngừa triệt để tình huống này, việc refactor mảng thành Dictionary là không còn cần thiết. Vấn đề "không nhập được tên riêng" đã được giải quyết bằng cách hiển thị lại ô input (ở dưới).

## Điểm 4 (Mới bổ sung): Ô "Tên DV" bị ẩn sai điều kiện - ✅ Đã Xong
- **Tình trạng:** Đã xóa bỏ điều kiện ẩn `selectedKtvIds.length > 1` cứng ngắc. Hiện tại ô "Tên DV..." sẽ tự động hiện ra cho các thẻ đã gộp (Merged Group) hoặc đã tách (Split Group), kèm theo placeholder là tên dịch vụ gốc để Lễ tân dễ hình dung.

---

# NHÓM LỖI "PHÒNG RIÊNG" (Dịch vụ tiện ích) — Bổ sung Vòng 4

> Vai trò tài liệu: nêu NGUYÊN NHÂN và RÀNG BUỘC. Người thi công tự chọn cách sửa.
> Lý do bổ sung: Phòng riêng (`NHS0900`, `is_utility = true`) gây lỗi lặp đi lặp lại
> ở nhiều tầng khác nhau. Gom lại một chỗ để xử lý dứt điểm.

## Điểm 6: Đơn bị tách khách sai → hiện 2 thẻ, tiền cộng gấp đôi ⚠️ ƯU TIÊN CAO (chạm tới tiền)

### Bằng chứng thực tế (đơn `11NDK-011-30082026`, ngày 30/08)

```
Bookings: totalAmount = 1.210.000 | guestCount = 1 | khách James

  NHS0900 (Phòng riêng)   price =   105.000  guest_id = a327c2ec...
  NHS1007 (dịch vụ chính) price = 1.105.000  guest_id = 36212368...
```

Một khách duy nhất nhưng **hai `guest_id` khác nhau**. Hậu quả trên bảng Kanban:
thẻ `#011` hiện **1tr210**, thẻ `#011-A` hiện **1tr105** → cộng lại 2.315.000
trong khi khách chỉ trả 1.210.000.

Đầu phiên làm việc hôm nay, hai item này **dùng chung một `guest_id`**. Chúng bị
tách ra trong quá trình thao tác.

### Nguyên nhân: cùng một đoạn logic tồn tại HAI BẢN, một bản đã sửa, một bản còn lỗi

**Bản CÒN LỖI** — trong `processDispatch()` (luồng điều phối thật), `actions.ts:654-655`:

```ts
// Ưu tiên kế thừa guest_id của chính các item trong nhóm, KHÔNG BỊ ẢNH HƯỞNG BỞI LOCK
let targetGuestId = itemIds.map(id => dbItemsMap.get(id)).find(id => id && !usedGuestIds.has(id));
```

**Bản ĐÚNG** — trong `saveDraftDispatch()` (luồng lưu nháp), `actions.ts:882-883`:

```ts
// Ưu tiên kế thừa guest_id của chính các item trong nhóm
let targetGuestId = itemIds.map(id => dbItemsMap.get(id)).find(id => id);
```

Comment ở bản lỗi ghi rõ "không bị ảnh hưởng bởi lock", nhưng code lại **có** áp lock
(`!usedGuestIds.has(id)`). Code mâu thuẫn với chính chú thích của nó. Ai đó đã sửa bản
nháp mà quên bản điều phối.

### Cơ chế đổ vỡ

1. Thẻ Kanban đã tách → bấm Gửi chỉ đưa **một item** vào `itemUpdates`.
2. Khối "lock" `actions.ts:645-651` đánh dấu `guest_id` của mọi item **không nằm trong**
   lần cập nhật này là "đã bị chiếm".
3. Vì Phòng riêng không nằm trong payload, `guest_id` chung bị đánh dấu đã chiếm.
4. Dòng 655 áp lock → không kế thừa được `guest_id` của chính mình → rơi xuống nhánh
   `crypto.randomUUID()` ở dòng 664 → **cấp một khách hoàn toàn mới**.

### Ràng buộc khi sửa

- Hai bản logic này phải **giống hệt nhau**. Sửa xong nên gom thành một hàm dùng chung
  để không tái diễn cảnh lệch bản.
- `guest_id` là khóa dùng cho **tách bill, chia tua, chia bonus** (xem `KTV_BONUS_LOGIC_README.md`).
  Sửa sai chỗ này ảnh hưởng trực tiếp tới tiền của KTV, không chỉ hiển thị.
- Khối lock (dòng 645-651) sinh ra để chống việc hai nhóm giành nhau một khách. Đừng xóa
  nó — chỉ cần cho phép một nhóm **kế thừa lại khách của chính nó**, đúng như comment mô tả.

### Dữ liệu cần dọn sau khi sửa

Đơn `11NDK-011-30082026` đang có 2 `guest_id` cho 1 khách. Cần gộp về một.
**Chưa làm** — chờ sửa code xong để tránh bị tách lại lần nữa.

## Điểm 7: Nhận diện "tiện ích" bị chép tay ở 6+ nơi 🔵 Ưu tiên thấp — nợ kỹ thuật

Cùng một biểu thức được chép lặp ở nhiều file:

```ts
is_utility === true
  || serviceId === 'NHS0900'
  || name.includes('phòng riêng')
  || name.includes('phong rieng')
```

Các nơi đã tìm thấy: `dispatch-timeline.ts` (4 chỗ: dòng 73, 145, 198, 458),
`KTVDashboard.logic.ts:1918`, `handleGetBooking.ts:485`, `handleFinishService.ts:282`,
`KtvWalletService.ts:96`, `QuickDispatchTable.tsx`, `DispatchServiceBlock.tsx`.

**Rủi ro:** thêm một dịch vụ tiện ích mới (xông hơi, nước uống...) và chỉ bật cờ
`is_utility` trong Admin thì vẫn chạy được — nhưng nếu ai đó **tắt** cờ `is_utility`
của Phòng riêng để thử nghiệm, ba điều kiện dò tên vẫn ép nó thành tiện ích. Cờ trong
Admin mất tác dụng, không ai hiểu vì sao.

**Ràng buộc:** đây là dọn nợ, không phải sửa lỗi đang cháy. Chỉ làm khi Điểm 6 đã xong
và ổn định. Gom thành một hàm `isUtilityService(item)` rồi bỏ dần phần dò tên tiếng Việt.

## Điểm 8: Item tiện ích kẹt trạng thái và mang chặng rác 🔵 Ưu tiên thấp — theo dõi

Quan sát trên hai đơn khác nhau:

- Đơn `11NDK-005-30082026`: item Phòng riêng còn `status = IN_PROGRESS` trong khi dịch vụ
  chính đã `DONE`, kèm chặng rác `NH027 @14:31→14:31 duration=0`.
- Đơn `11NDK-011-30082026`: item Phòng riêng mang chặng `NH016 @23:28 duration=0`
  dù `technicianCodes = []`.

**Đã kiểm chứng là vô hại về tiền:** mọi truy vấn tính công/tính tiền đều lọc theo
`technicianCodes`, mà cột này rỗng nên không ai đọc tới các chặng đó. `TurnQueue` của
KTV liên quan cũng ở trạng thái `off` bình thường, không bị kẹt.

**Vì sao vẫn ghi nhận:** nó khiến đơn treo `IN_PROGRESS` trên bảng Lễ tân dù đã xong,
và là mầm lỗi nếu sau này có đoạn code nào đọc `segments` mà không kiểm tra
`technicianCodes` trước.

## Thứ tự đề nghị

1. **Điểm 6 trước** — chạm tới tiền và tách bill.
2. Kiểm chứng bằng một đơn **hoàn toàn mới** (đơn 011 đã lệch dữ liệu, không dùng để test được nữa).
3. Điểm 7 và 8 để sau, khi không còn lỗi nào đang cháy.

## Cách kiểm chứng Điểm 6

Tạo đơn mới còn `pending`, có dịch vụ chính + Phòng riêng gộp chung, 2 KTV làm nối tiếp.
Bấm Gửi **từng thẻ một**. Sau mỗi lần bấm, kiểm tra:

```sql
SELECT id, "serviceId", guest_id FROM public."BookingItems"
WHERE "bookingId" = '<mã đơn>' ORDER BY id;
```

Cả hai item **phải cùng một `guest_id`** sau mọi lần gửi. Nếu tách ra là chưa hết bệnh.

Đối chiếu thêm trên Kanban: chỉ được hiện **một thẻ cho một khách**, và số tiền phải
khớp `Bookings.totalAmount`, không cộng dồn.

---

# BỔ SUNG VÒNG 5 — Sau khi test thật đơn `TEST-260830-RPQ5`

> Kết quả test: **Điểm 6 ĐẠT** — sau khi gửi từng thẻ, hai item vẫn chung một
> `guest_id`, `BookingGuests` chỉ 1 dòng. Tên riêng theo KTV cũng lưu và hiện đúng
> ở cả 4 tầng. Hai lỗi dưới đây là phát hiện MỚI trong lượt test đó.

## Điểm 9: Thẻ nối tiếp cộng trùng tiền dịch vụ dùng chung ⚠️ ƯU TIÊN CAO (chạm tới tiền)

### Bằng chứng

Đơn `TEST-260830-RPQ5` (`d89b64e2-...`), `totalAmount = 895.000`, đúng 1 khách:

```
NHS1002  790.000  tech = ["NH016","NH079"]   ← 1 dịch vụ, 2 KTV làm nối tiếp
NHS0900  105.000  tech = ["NH016"]           ← Phòng riêng
```

Trên Kanban lại hiện:

```
Thẻ #TEST   (NH016) → 895k     = 790k + 105k
Thẻ #TEST-A (NH079) → 790k     = 790k  ← ĐẾM LẠI dịch vụ đã tính ở thẻ trước
                      ------
                      1.685.000  trong khi khách chỉ trả 895.000
```

### Nguyên nhân

`KanbanBoard.tsx:645` cộng giá mọi dịch vụ nằm trong thẻ:

```ts
const subOrderTotal = services.reduce((acc, svc) => acc + (svc.price || 0) * (svc.quantity || 1), 0);
```

Với ca nối tiếp, `dispatch-timeline.ts:276` chẻ **một** dịch vụ thành **hai** khối ảo
(`{ ...svc, staffList: staffs, _splitTime: time }`) — cả hai giữ nguyên `price` gốc.
Nên dịch vụ 790k xuất hiện đủ giá trên cả hai thẻ.

Phòng riêng thì bị `dispatch-timeline.ts:463` đẩy vào thẻ đầu tiên
(`resultForOrder[0].services.push(...utilityServices)`), làm thẻ 1 thành 895k.

### Yêu cầu (đã chốt với chủ tiệm)

**Chỉ thẻ ĐẦU TIÊN trong nhóm nối tiếp hiện giá. Các thẻ sau ghi "Đã tính ở thẻ trước".**

Chỗ sửa: `KanbanBoard.tsx:681` — nơi render `formatCompactPrice(subOrderTotal)`.

### Ràng buộc bắt buộc

1. **Chỉ áp cho thẻ nối tiếp cùng một dịch vụ.** Phải phân biệt được hai tình huống:
   - *Nối tiếp*: cùng `bookingId`, cùng khách, chung một `svc.id`, khác `_splitTime`
     → thẻ sau ghi "Đã tính ở thẻ trước".
   - *Nhiều khách thật* (đơn `-A`, `-B` có `parent_booking_id`): mỗi khách trả tiền
     riêng → **mọi thẻ đều phải hiện giá của mình**. Nhầm chỗ này là giấu mất tiền thật.

2. **Xác định "thẻ đầu tiên" theo thời gian**, không theo thứ tự mảng. Dùng `_splitTime`
   nhỏ nhất, hoặc `calculatedStart` sớm nhất. Thứ tự mảng có thể đổi giữa các lần render.

3. **Giữ nguyên `title={formatVND(subOrderTotal)}`** (tooltip khi rê chuột) hoặc đổi
   thành tổng đơn — để Lễ tân vẫn tra được số thật khi cần.

4. **Không đụng cách tính `subOrderTotal`.** Chỉ đổi phần *hiển thị*. Con số vẫn phải
   dùng được cho các mục đích khác.

### Cách kiểm chứng

- Đơn nối tiếp 1 khách 2 KTV → thẻ đầu hiện giá, thẻ sau ghi "Đã tính ở thẻ trước".
  Tổng nhìn thấy trên bảng = `Bookings.totalAmount`.
- Đơn nhiều khách thật (`-A`, `-B`) → **cả hai thẻ vẫn hiện giá riêng**, không thẻ nào
  bị ghi "đã tính".
- Đơn thường 1 KTV 1 dịch vụ → không đổi gì.

## Điểm 10: Dịch vụ tiện ích bị gán KTV ⚠️ ƯU TIÊN CAO (rò rỉ hoa hồng)

### Bằng chứng

Cùng đơn test:

```
NHS0900 (Phòng riêng, is_utility = true)   tech = ["NH016"]   segs = NH016@02:17:0p
```

Trái với thiết kế đã ghi trong `TableInSupabase.md`:
*"`is_utility` — Không gán KTV, không tính hoa hồng, không hiện timer KTV"*.

### Nguyên nhân

`page.tsx:1426` loại trừ dựa vào **`mergedIntoId`**, không phải **`is_utility`**:

```ts
technicianCodes: svc.mergedIntoId ? [] : svc.staffList.map(r => r.ktvId).filter(Boolean),
```

- Phòng riêng **có gộp** (đơn 011) → `mergedIntoId` có → `[]` → đúng.
- Phòng riêng **không gộp** (đơn TEST) → rơi vào nhánh else → **nhận KTV** → sai.

### Vì sao đây là lỗi tiền, không chỉ dữ liệu bẩn

**Đường 1 — cửa hậu trong ví tua.** `KtvWalletService.ts:96-99`:

```ts
let relevantItems = relevantItemsOriginal.filter(i => !svcUtilityMap[String(i.serviceId)]);
if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
    relevantItems = relevantItemsOriginal;   // tiện ích lọt lại vào tính tiền
}
```

Nếu một KTV chỉ được gán **mỗi** Phòng riêng và không dịch vụ nào khác, fallback đưa
item tiện ích trở lại → KTV đó **được tính hoa hồng cho Phòng riêng**.

**Đường 2 — loãng điểm bonus.** `KtvCommissionService.calculateBookingBonus` quét
`technicianCodes` của **mọi** item để đếm số KTV chia điểm, **không lọc tiện ích**.
Một KTV chỉ đứng tên Phòng riêng vẫn làm tăng mẫu số → mọi người bị chia điểm ít đi.

### Yêu cầu

Sửa `page.tsx:1426`: điều kiện loại trừ phải bao gồm cả tiện ích. Dùng hàm
`isUtilityService()` đã có sẵn trong `lib/booking.logic.ts` thay vì viết lại điều kiện.

### Ràng buộc

- **KHÔNG đụng cửa hậu ở `KtvWalletService.ts:97` lúc này.** Nó sinh ra để cứu dữ liệu cũ
  (đơn mà mọi item đều bị đánh dấu tiện ích nhầm). Bỏ đi có thể làm mất tiền của đơn lịch sử.
  Sửa `page.tsx:1426` là chặn được nguồn. Cửa hậu rà riêng sau, khi đã khảo sát dữ liệu cũ.
- **KHÔNG đụng `lib/services/KtvWalletService.ts`** trong đợt này.
- Sau khi sửa, item tiện ích phải có `technicianCodes = []` **bất kể** có gộp hay không.

### Cách kiểm chứng

Tạo đơn mới có Phòng riêng **không gộp**, gán KTV, bấm Gửi:

```sql
SELECT "serviceId", "technicianCodes" FROM public."BookingItems"
WHERE "bookingId" = '<mã đơn>' ORDER BY id;
```

`NHS0900` phải có `technicianCodes = {}` (rỗng). Làm lại với Phòng riêng **có gộp** —
kết quả phải giống hệt.

### Dữ liệu cần dọn

Đơn `d89b64e2-...` đang có `NHS0900 tech = ["NH016"]`. Nếu là đơn thử thì xóa;
nếu giữ để đối chiếu thì cần SQL gỡ KTV khỏi item tiện ích. **Chưa làm.**

## Thứ tự đề nghị

Điểm 10 trước (rò rỉ hoa hồng, sửa một dòng), rồi Điểm 9 (hiển thị, phức tạp hơn vì
phải phân biệt nối tiếp với nhiều khách thật).

---

# Điểm 11: Cho phép tạo khách chỉ có dịch vụ tiện ích 🟡 Nghiệp vụ — KHÔNG chặn deploy

> Phát hiện khi test đơn `TEST-260830-OY3N` ngày 31/08.
> Đây là lỗi **quy tắc nghiệp vụ**, không phải lỗi kỹ thuật. Điểm 9 và 10 vẫn chạy đúng
> trên đơn này. Ghi lại để xử lý sau khi deploy.

## Hiện trạng

```
TEST-260830-OY3N     SPLIT  total = 0        (đơn cha)
  ├─ OY3N-A  NEW  790.000   NHS1002  tech = ["NH016","NH079"]   ← Khách A: dịch vụ chính
  └─ OY3N-B  NEW  105.000   NHS0900  tech = []                  ← Khách B: CHỈ Phòng riêng
```

Lễ tân tách thành hai khách, nhưng **Khách B chỉ có mỗi Phòng riêng**, không có dịch vụ
chính nào.

## Vì sao đây là sai nghiệp vụ

Phòng riêng (`NHS0900`, `is_utility = true`) là dịch vụ **phụ trợ**. Nó không thể tồn tại
độc lập cho một người khách — khách phải mua dịch vụ chính rồi mới cộng thêm phòng.

Một "khách" chỉ có tiện ích thì:
- Không có KTV nào phục vụ (đúng, vì tiện ích không gán KTV — xem Điểm 10)
- Không sinh tua, không sinh hoa hồng, không sinh bonus
- Nhưng vẫn chiếm một `guest_id`, một dòng `BookingGuests`, một thẻ trên Kanban
- Và `guestCount` của đơn cha bị đếm thành 2 thay vì 1

`guestCount` là tham số dùng trong công thức chia bonus
(`KtvCommissionService.calculateBookingBonus`), nên đếm sai khách **có thể ảnh hưởng
điểm thưởng** của KTV ở các đơn tương tự.

## Yêu cầu (đã chốt với chủ tiệm)

**Cảnh báo hoặc chặn, không cho tạo một khách chỉ gồm dịch vụ tiện ích.**

## Vị trí

`app/reception/dispatch/_components/QuickDispatchTable.tsx`

- `handleSplitServices()` — dòng 209. Nút "✂ TÁCH KHÁCH (HỦY GỘP)". Đây là nơi Lễ tân
  xé nhóm ra thành từng khách riêng. Hiện chỉ kiểm tra `selectedGroupKeys.length === 0`,
  không kiểm tra nội dung nhóm sau khi tách.
- `handleGroupServices()` — dòng 187. Nút "GỘP ĐƠN KHÁC KTV". Cần rà xem thao tác gộp
  có thể gián tiếp để lại một nhóm chỉ còn tiện ích không.

## Ràng buộc

1. **Dùng `isUtilityService()`** trong `lib/booking.logic.ts`, không viết lại điều kiện
   nhận diện tiện ích.

2. **Cảnh báo hay chặn cứng — cần chủ tiệm quyết.** Chặn cứng an toàn hơn nhưng có thể
   cản trở tình huống ngoại lệ hợp lệ mà ta chưa lường tới. Nếu chọn cảnh báo thì phải
   là hộp thoại xác nhận, không phải toast thoáng qua.

3. **Không tự động gộp lại.** Đừng để hệ thống tự quyết Phòng riêng thuộc về khách nào —
   sai chỗ này sẽ gán tiền vào nhầm khách. Để Lễ tân tự chọn.

4. **Không đụng dữ liệu đã có.** Đơn `OY3N` cứ để nguyên làm chứng cứ.

## Kiểm chứng

- Tạo đơn có 1 dịch vụ chính + Phòng riêng → bấm "TÁCH KHÁCH" → phải cảnh báo/chặn.
- Tạo đơn có 2 dịch vụ chính + Phòng riêng → tách 2 dịch vụ chính thành 2 khách → phải
  cho phép (vì mỗi khách đều có dịch vụ chính), Phòng riêng đi theo một trong hai.
- Đơn thường không có tiện ích → tách bình thường, không cảnh báo gì.

## Ghi chú về mức độ ưu tiên

Không chặn deploy. Điểm 9 (tiền nối tiếp) và Điểm 10 (tiện ích không nhận KTV) đã kiểm
chứng đạt trên chính đơn này — `OY3N-B` có `merged = KHÔNG` mà `technicianCodes = []`,
đó là lần đầu vế `isUtilityService` mới được thực sự kích hoạt.
