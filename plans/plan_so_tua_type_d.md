# 📋 Plan — Sổ tua KTV Loại D + Bộ lọc loại KTV

> **Ngày**: 2026-09-03 · **Nhánh**: `feat/bit-lo-hong-phase1`
> **Trạng thái chung Loại D**: `plans/TYPE_D_MASTER.md` (đây là Phase 6 còn dở)
> **Phạm vi đã rà code thật**: `app/api/turns/route.ts`, `lib/services/KtvTypeDTurnService.ts`, `app/api/ktv/type-d/service-hours/route.ts`, `app/api/cron/reset-type-d-hours/route.ts`, `lib/services/KtvTypeDDisciplineService.ts`, `lib/services/KtvCommissionService.ts`, `components/shared/TurnQueueBoard/`, migration `20260901000000_add_type_d_support.sql`

> **Quy ước đọc**: *tăng dần* = số nhỏ đứng trước (ASC) · *giảm dần* = số lớn đứng trước (DESC).

---

## 1. Luật nghiệp vụ

Sổ tua Loại D **không** xếp theo số tua như A/B/C. Xếp theo **tổng thời gian đã lên tua làm cho khách trong tháng**:

```
điểm xếp hạng = tổng phút phục vụ khách trong tháng − giờ bị phạt kỷ luật
thứ tự gán:    NHIỀU giờ đứng TRƯỚC  (giảm dần)
reset:         về 0 mỗi đầu tháng
mốc tính:      chỉ tính từ work_type_effective_from (ngày vào chế độ D)
```

✅ **Đã chốt 03/09**: **giảm dần** — người làm nhiều giờ nhất được gán khách tiếp theo trước.

Đối chiếu để khỏi nhầm:

| Loại | So theo | Hướng | Nghĩa |
|---|---|---|---|
| A, B, C | `turns_completed` (số tua) | **tăng dần** ↑ | ít tua → ưu tiên trước |
| **D** | `net_hours` (giờ làm khách) | **giảm dần** ↓ | nhiều giờ → ưu tiên trước |

Hai loại **ngược chiều nhau**, không quy đổi được sang nhau — đó là lý do không trộn chung thành một bảng xếp hạng.

---

## 2. HIỆN TRẠNG — sổ tua Loại D **thực tế KHÔNG chạy**

Đây là kết luận quan trọng nhất của đợt rà này. Code trông như đã làm xong, nhưng không có tác dụng.

### 2.1 🔴 P0 — Sort đọc bảng luôn rỗng

`app/api/turns/route.ts:57-62` đọc `KTVMonthlyServiceHours` với **tháng hiện tại**:

```ts
const now = new Date();
const month = now.getMonth() + 1;      // ← THÁNG NÀY
const year  = now.getFullYear();
...
.eq('month', month).eq('year', year)
```

Nhưng bảng đó **chỉ được ghi bởi** `app/api/cron/reset-type-d-hours/route.ts`, chạy `0 17 1 * *` (mùng 1 hằng tháng), và nó ghi cho **THÁNG TRƯỚC**:

```ts
const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const year  = prevMonthDate.getFullYear();
const month = prevMonthDate.getMonth() + 1;   // ← THÁNG TRƯỚC
```

**→ Không bao giờ có dòng nào cho tháng hiện tại.** `monthlyHoursMap` luôn rỗng → mọi KTV Loại D đều nhận `0` giờ → `typeD.sort(...)` so `0 - 0` → **thứ tự rơi về `turns_completed` tăng dần, y như A/B/C**.

Nói cách khác: **luật xếp tua của Loại D chưa từng có hiệu lực một ngày nào.**

### 2.2 🔴 P0 — Không ai ghi `hours_earned`

`KTVServiceHoursLedger` có cột `hours_earned`, nhưng grep toàn repo: **chỉ `KtvTypeDDisciplineService.ts:18,58` ghi vào bảng này, và chỉ ghi `hours_penalty`.** Không dòng code nào ghi `hours_earned`.

Hệ quả cho `KtvTypeDTurnService.ts:55-56`:

```ts
staffHoursMap[row.staff_id] += (earned - penalty);   // earned LUÔN = 0
```

→ ra **số âm**. Và service này **không** có `Math.max(0, ...)`. Kết quả: ai bị phạt nhiều nhất tụt xuống cuối, ai sạch thì bằng 0 — thành bảng xếp hạng kỷ luật, không phải bảng giờ làm.

### 2.3 🔴 P0 — `KtvTypeDTurnService` là code chết

Grep toàn repo: service này **chỉ được gọi bởi `scripts/simulate_type_d_turn_order.ts`**. Không route nào, không component nào dùng. Test xanh nhưng sản phẩm không chạy qua nó.

### 2.4 🔴 P0 — Có đường đi **vòng qua API**, sắp xếp lại bằng số tua

`components/shared/TurnQueueBoard/TurnQueueBoard.logic.ts:78-88` — hàm `fetchTurnsFromDB()` **không gọi `/api/turns`**, mà query thẳng Supabase:

```ts
.from('TurnQueue')
.eq('date', today)
.order('turns_completed', { ascending: true })
.order('check_in_order',  { ascending: true });
```

Hàm này dùng cho đường **realtime** (khi `TurnQueue` đổi thì refresh nhanh, không cần re-sync). Nghĩa là: sửa `/api/turns` cho đúng xong, thì **ngay lần realtime đầu tiên thứ tự lại nhảy về số tua tăng dần**.

Sổ tua có **hai đường lấy dữ liệu** với **hai cách sắp xếp khác nhau** — bắt buộc gộp về một.

### 2.5 🟠 P1 — Ba nguồn giờ mâu thuẫn nhau

| Nơi | Nguồn | Có trừ phạt | Kẹp sàn 0 | Tôn trọng `work_type_effective_from` | Tie-break |
|---|---|---|---|---|---|
| `KtvTypeDTurnService` | `KTVServiceHoursLedger` | ✅ | ❌ | ✅ | `check_in_order` |
| `turns/route.ts` | `KTVMonthlyServiceHours` | (gián tiếp) | — | ❌ | không có |
| `service-hours/route.ts` | tính thẳng từ `Bookings` | ✅ | ✅ | ❌ | — |

Ba nơi, ba kết quả khác nhau cho cùng một câu hỏi *"KTV này đã làm bao nhiêu giờ tháng này"*.

### 2.6 🟠 P1 — `service-hours` quét `Bookings` cực phí

`app/api/ktv/type-d/service-hours/route.ts:47-58`: vòng lặp `for (const staffId of staffIds)`, bên trong phân trang **toàn bộ bảng `Bookings`** của cả tháng — **không hề filter theo `staffId` trong query**, lọc bằng JS sau khi tải về. Với N KTV Loại D thì quét bảng `Bookings` **N lần**.

### 2.7 🟠 P1 — `work_type_effective_from` bị bỏ qua

`plan_che_do_type_d.md` §2.2 chốt: **giờ tích lũy reset về 0 khi chuyển chế độ**, chỉ tính bản ghi có `date >= work_type_effective_from` — để chặn kẽ hở chuyển ra/vào né phạt hoặc giữ hạng.

Chỉ `KtvTypeDTurnService` (code chết) làm điều này. `service-hours/route.ts` — nơi tính giờ thật — **không hề đọc `work_type_effective_from`**.

### 2.8 🟡 P2 — Công thức phút lệch với plan

`plan_che_do_type_d.md` chốt `phút = min(thời_gian_thực, thời_gian_gán)`.

`KtvCommissionService.calculateItemDuration()` (dòng 278-308) **tính `realMins` rồi vứt đi**, `return sum + baseMins` — tức **luôn lấy thời gian GÁN**. Comment dòng 304-306 nói đây là cố ý ("không trả thêm tiền cho người làm chậm").

Với **tiền** thì cố ý này hợp lý. Nhưng sổ tua đang **dùng chung hàm này** — cần chốt: giờ xếp hạng lấy theo giờ gán hay giờ thực?

### 2.9 🟡 P2 — Màn điều phối chưa tách loại

`app/reception/dispatch/_components/QuickDispatchTable.tsx` grep `TYPE_D` = **0 kết quả**. Vẫn sắp xếp trộn chung mọi loại KTV theo số tua tăng dần.

### 2.10 📍 Kiểm kê ĐẦY ĐỦ các màn đụng sổ tua

Quét `turns_completed` + `TurnQueue` toàn repo. **Năm** nơi hiển thị/sắp xếp sổ tua:

| # | Màn | File | Đường lấy dữ liệu | Trạng thái |
|---|---|---|---|---|
| 1 | Sổ tua lễ tân | `app/reception/turns/turns.logic.ts:25` | `/api/turns` | Sửa ở Bước 7 |
| 2 | **Quản lý nhân viên (KTV Hub)** | `app/reception/ktv-hub/page.tsx:444` | **dùng chung `TurnQueueBoard`** | ✅ Sửa `TurnQueueBoard` là tự đúng |
| 3 | Bảng tua dùng chung | `TurnQueueBoard.logic.ts:50` + `:78` | API **và** query thẳng DB | Bước 4 + Bước 7 |
| 4 | Điều phối — bảng nhanh | `QuickDispatchTable.tsx:1201-1207` | **client tự sắp xếp** | Bước 8 |
| 5 | Dashboard KTV | `app/ktv/dashboard/page.tsx:368` | `/api/turns` | Chỉ xem của mình, không cần lọc |

**Tin tốt**: màn **Quản lý nhân viên** (`ktv-hub`) render thẳng `<TurnQueueBoard allowEditTurns={true} />` — **dùng chung component**. Sửa `TurnQueueBoard` một lần là cả hai màn cùng đúng, kể cả bộ lọc. Không phải làm hai lần.

**Chỗ phải sửa riêng**: `QuickDispatchTable.tsx:1201-1207` **tự sắp xếp ở client**, không đi qua `TurnQueueBoard`:

```ts
return filtered.sort((a, b) => {
    ...
    if (a.turns_completed !== b.turns_completed) return (a.turns_completed || 0) - (b.turns_completed || 0);
```

→ trộn chung mọi loại KTV theo số tua tăng dần, Loại D bị cuốn theo. Đây là Bước 8.

### 2.11 🔴 P0 — Lỗi thật ở màn Quản lý nhân viên: sai tên cột, xoá hụt sổ tua

`app/admin/employees/actions.ts:173-180` — khi cho nhân viên nghỉ việc, code gỡ họ khỏi sổ tua:

```ts
const { error: turnQueueError } = await supabase
    .from('TurnQueue')
    .delete()
    .eq('employeeId', id);        // ❌ SAI TÊN CỘT
if (turnQueueError) {
    console.warn(`… Could not remove staff ${id} from TurnQueue:`, turnQueueError);
}
```

Cột thật trong `TurnQueue` là **`employee_id`** (snake_case) — xem `TableInSupabase.md` dòng 167, và **mọi file khác trong repo đều dùng `employee_id`**; đây là chỗ duy nhất viết `employeeId`.

Hai lớp che lỗi:
1. Tên cột sai → Supabase trả lỗi, **không xoá được dòng nào**.
2. Lỗi chỉ được `console.warn`, **không throw** → giao diện báo "thành công" bình thường.

**→ KTV đã nghỉ việc vẫn nằm trong sổ tua và vẫn được điều phối khách.**

**Việc cần làm**: đổi `employeeId` → `employee_id`. Đổi `console.warn` thành ném lỗi thật, hoặc ít nhất hiển thị cảnh báo lên giao diện.

**Nghiệm thu**: đếm `TurnQueue` có `employee_id` trỏ tới `Staff` đã nghỉ việc — nếu **> 0** thì đang có rác thật, dán con số ra và dọn.

> Lỗi này **không thuộc Loại D**, nhưng nằm đúng vùng đang sửa và ảnh hưởng mọi loại KTV. Sửa luôn trong đợt này.

### 2.12 🟡 P2 — KTV Hub reset `turns_completed` về 0 khi đổi trạng thái

`app/reception/ktv-hub/page.tsx:531-548`: khi chuyển một KTV sang `on_duty`, `turnPayload` chứa `turns_completed: 0` và được dùng cho **cả nhánh `update`** dòng bản ghi đã có.

Nghĩa là: KTV đang làm giữa ngày, đã xong vài tua, bị đổi trạng thái qua lại → **số tua bị xoá về 0**, tụt lên đầu hàng đợi.

Cần xác nhận: cố ý hay lỗi? Nếu là lỗi thì nhánh `update` không được đụng `turns_completed`.

---

## 3. QUYẾT ĐỊNH KIẾN TRÚC — chốt trước khi code

Vấn đề gốc: **giờ tích lũy đang được tính lại từ `Bookings` mỗi lần đọc** — đắt, chậm, và mỗi nơi tính một kiểu.

| Hướng | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **A. Tính realtime** | Bỏ hẳn 2 bảng, mỗi lần đọc sổ tua thì tính từ `Bookings` | Không bao giờ lệch | Chậm; sổ tua là màn lễ tân bấm liên tục |
| **B. Chốt sổ hằng đêm** ⭐ | Cron đêm ghi `hours_earned` vào `KTVServiceHoursLedger` theo ngày; đọc thì cộng dồn trong tháng | Nhanh, có lịch sử, khớp mô hình ledger sẵn có | Giờ của **hôm nay** chưa vào sổ → phải cộng bù phần trong ngày |
| **C. Ghi ngay khi xong tua** | Booking chuyển `DONE` thì insert luôn 1 dòng ledger | Realtime + nhanh | Phải bắt mọi đường đổi status; dễ sót; dễ ghi trùng |

**Đề xuất: hướng B**, vì:
- Bảng `KTVServiceHoursLedger` đã có sẵn cột `hours_earned` + `booking_id` + **unique index `(staff_id, date, booking_id)`** (migration dòng 50-52) — thiết kế ban đầu rõ ràng dành cho hướng này, chỉ là chưa ai viết phần ghi.
- Trùng đúng mô hình ví Loại D đang chạy (cron chốt quá khứ + tính bù phần realtime).
- Cron đêm của Loại D **đã tồn tại** → thêm một bước ghi giờ vào đó, không cần cron mới.

> ❓ **Cần bạn chốt**: đi hướng B chứ?

---

## 4. KẾ HOẠCH THỰC HIỆN (theo hướng B)

### Bước 1 — Một nguồn sự thật duy nhất cho "giờ tích lũy"

Viết **một** hàm dùng chung, ví dụ `KtvTypeDTurnService.getMonthlyHours(supabase, staffIds, month, year)`:

```
net_hours = tổng(hours_earned) − tổng(hours_penalty)     -- từ KTVServiceHoursLedger
          + giờ phát sinh HÔM NAY chưa vào sổ            -- tính từ Bookings, chỉ 1 ngày
          , chỉ lấy dòng có date >= Staff.work_type_effective_from
          , kẹp sàn Math.max(0, …)
```

Mọi nơi cần con số này **phải gọi hàm đó**, không nơi nào được tự tính lại: `turns/route.ts`, `service-hours/route.ts`, `finance/ktv-summary/route.ts:310`, UI.

**Nghiệm thu**: cùng một KTV, 3 màn (sổ tua lễ tân, màn giờ tích lũy của KTV, báo cáo tài chính) ra **cùng một số**.

### Bước 2 — Ghi `hours_earned` vào cron đêm

Thêm vào `app/api/cron/sync-daily-ledger-type-d/route.ts`: với mỗi booking item đã `DONE` của KTV Loại D trong ngày, upsert 1 dòng:

```ts
{ staff_id, date: targetDateStr, booking_id, hours_earned: <phút>/60, hours_penalty: 0 }
```

Dùng `onConflict: 'staff_id,date,booking_id'` để **idempotent** — cron chạy lại 2 lần không được cộng đôi. Unique index đã có sẵn ở migration dòng 50-52.

> ⚠️ Cron này **đã** duyệt qua đúng tập booking đó để tính tiền. **Dùng lại vòng lặp có sẵn**, đừng query `Bookings` thêm lần nữa.

**Nghiệm thu**: chạy cron 2 lần cho cùng 1 ngày → số dòng ledger và tổng giờ **không đổi**. Dán số thật.

### Bước 3 — Sửa lỗi tháng ở `turns/route.ts`

Thay toàn bộ khối `KTVMonthlyServiceHours` (dòng 51-70) bằng lời gọi hàm ở Bước 1.

> `KTVMonthlyServiceHours` **vẫn giữ**, nhưng đổi vai trò: chỉ là **bản chốt lịch sử của các tháng đã đóng**, phục vụ báo cáo. Không dùng để xếp tua tháng hiện tại.

**Nghiệm thu**: 2 KTV Loại D có giờ chênh nhau rõ rệt → gọi `GET /api/turns` → thứ tự đúng. **Dán JSON thật.** (Hiện tại test này chắc chắn fail — đó chính là bằng chứng của §2.1.)

### Bước 4 — Gộp hai đường lấy dữ liệu (§2.4)

`TurnQueueBoard.logic.ts:78` — `fetchTurnsFromDB()` phải **dùng chung `/api/turns`**. Nếu bắt buộc giữ đường realtime nhanh vì lý do tốc độ thì phải **áp cùng một hàm nhóm + sắp xếp** ở client.

Không được để hai luật sắp xếp tồn tại song song. Đây là điều kiện cần để mọi bước sau có ý nghĩa.

**Nghiệm thu**: mở sổ tua → sửa một booking để realtime bắn về → thứ tự **không nhảy**.

### Bước 5 — Tie-break và thứ tự ổn định

Chốt thứ tự so sánh, áp **một lần** trong hàm dùng chung:

```
1. net_hours       giảm dần
2. check_in_order  tăng dần    (ai đến tiệm trước)
3. employee_id     tăng dần    (chốt chặn, để thứ tự không nhảy giữa 2 lần load)
```

Hiện `turns/route.ts` **không có tie-break nào** → 2 KTV cùng 0 giờ sẽ nhảy thứ tự ngẫu nhiên giữa các lần refresh. Lễ tân đang bấm mà thứ tự tự đổi.

### Bước 6 — Tôn trọng `work_type_effective_from`

Áp trong hàm ở Bước 1, cho **cả** phần đọc ledger lẫn phần bù trong ngày.

**Nghiệm thu**: lấy 1 KTV, set `work_type_effective_from` = giữa tháng → giờ tích lũy phải **giảm**, chỉ còn phần từ ngày đó trở đi.

---

### Bước 7 — Bộ lọc loại KTV ⭐

#### 7.1 Luật nhóm (chủ dự án chốt 03/09)

**Tách lẻ từng loại — chọn loại nào hiện đúng loại đó. A và B KHÔNG gộp chung.**

| Bộ lọc | Gồm | Xếp theo |
|---|---|---|
| **Tất cả** | **A + B + D** (❗ **KHÔNG có C**) | 3 khối nối tiếp: [A] → [B] → [D] |
| **A** | Chỉ A | số tua, **tăng dần** |
| **B** | Chỉ B | số tua, **tăng dần** |
| **C** | Chỉ C — **luôn luôn đứng riêng**, không bao giờ gộp vào nhóm nào | như hiện tại |
| **D** | Chỉ D | giờ làm khách, **giảm dần** |

Hai điểm dễ quên:
- **C không nằm trong "Tất cả"**. Muốn xem C phải chọn đúng bộ lọc C.
- **A và B là hai khối riêng biệt**, kể cả khi đang ở "Tất cả" — mỗi khối một tiêu đề, một bảng.

#### 7.2 Đã có sẵn trong code — dùng lại, đừng làm mới

`components/shared/TurnQueueBoard/TurnQueueBoard.tsx:48` **đã có** tab `'internal' | 'external'`:
- `external` = C (KTV nhập tay) — chính là "C đã tách riêng"
- `internal` = A + B, và hiện **D đang lẫn vào đây**

→ Việc cần làm là **mở rộng tab sẵn có** thành 5 tab: `Tất cả` · `A` · `B` · `C` · `D`, không phải dựng lại từ đầu.

#### 7.3 ⚠️ Nợ kỹ thuật phải xử lý cùng lúc: đang tách C bằng tiền tố mã

`TurnQueueBoard.logic.ts:59-62` và `:85-87` tách C bằng **tiền tố mã nhân viên**, không phải `work_type`:

```ts
t.employee_id.startsWith('EXT') || t.employee_id.startsWith('C_')
```

Đúng là `app/reception/dispatch/actions.ts:546` sinh mã `EXT_xxxxx` cho KTV TYPE_C mới. **Nhưng** một KTV `work_type = 'TYPE_C'` có mã **không** bắt đầu bằng `EXT`/`C_` — KTV cũ chuyển sang C, hoặc thêm tay từ Admin — sẽ **lọt vào nhóm internal**, tức lọt vào "Tất cả", **trái luật vừa chốt**.

→ Bước này **đổi tiêu chí nhóm từ tiền tố mã sang `work_type`**. Đây là điều kiện cần để luật "C luôn riêng" đúng trong mọi trường hợp.

**Nghiệm thu riêng**: chạy query đếm `Staff` có `work_type='TYPE_C'` mà `id` không bắt đầu bằng `EXT`/`C_`. Nếu **> 0** thì hiện đang có KTV C bị xếp nhầm nhóm — dán con số thật, trước và sau khi sửa.

#### 7.4 Server

`app/api/turns/route.ts` nhận thêm query param `workType`:

```
GET /api/turns?date=…                    → mặc định = tất cả → A + B + D (KHÔNG có C), đã nhóm sẵn
GET /api/turns?date=…&workType=TYPE_A    → chỉ A
GET /api/turns?date=…&workType=TYPE_B    → chỉ B
GET /api/turns?date=…&workType=TYPE_C    → chỉ C
GET /api/turns?date=…&workType=TYPE_D    → chỉ D
```

Dùng thẳng giá trị `work_type` làm tham số — sau này thêm loại E thì không phải đẻ thêm quy ước.

- Lọc theo **`Staff.work_type`**, không theo tiền tố mã.
- Sắp xếp **luôn làm ở server**, client tuyệt đối không sắp xếp lại (xem §2.4).
- Mỗi bản ghi trả kèm `work_type` và, với Loại D, `net_hours` — để UI hiển thị và nhóm mà không phải gọi thêm API `EMPLOYEES`.
- `workType` không hợp lệ → coi như "tất cả". **Không trả lỗi** — lễ tân đang bấm, không được vỡ màn hình.
- ❗ "Tất cả" **phải loại C ra**. Đây là chỗ dễ quên nhất của cả bước này — viết test riêng cho nó.

#### 7.5 Client

1. `TurnQueueBoard.tsx:48` — mở rộng `activeTab` từ `'internal' | 'external'` thành `'all' | 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D'`. Nhãn tab: **Tất cả** · **A** · **B** · **C** · **D**.
2. `TurnQueueBoard.logic.ts` — đổi `internal`/`external` từ tiền tố mã sang `work_type` (§7.3). Đường realtime đã gộp ở Bước 4.
3. `app/reception/turns/page.tsx` + `turns.logic.ts:25` — thêm cùng bộ lọc, nhớ lựa chọn bằng `localStorage` để lễ tân không phải chọn lại sau mỗi lần refresh.
4. `app/reception/ktv-hub/page.tsx:444` (**Quản lý nhân viên**) — **không phải sửa gì**, màn này render thẳng `<TurnQueueBoard allowEditTurns={true} />` nên được hưởng bộ lọc từ mục 1. **Nhưng bắt buộc mở ra kiểm tra**: bộ lọc hiện đúng, và `allowEditTurns` (sửa tua thủ công) vẫn hoạt động ở từng tab.
5. `app/ktv/dashboard/page.tsx:368` — KTV chỉ xem sổ của mình; xác nhận thứ tự đúng, **không cần** bộ lọc.

**Hiển thị**: khối Loại D có thêm cột **"Giờ tháng này"**; khối A, B, C giữ cột **"Số tua"** như cũ. Không hiện cột giờ cho A/B/C (họ không có số đó). Với D vẫn hiện được số tua nhưng phải ghi rõ là *tham khảo*, không phải tiêu chí xếp hạng.

#### 7.6 Nghiệm thu

- **Tất cả** → thấy 3 khối [A] → [B] → [D], mỗi khối một tiêu đề. **Không một KTV C nào xuất hiện.** Đếm số dòng để chắc.
- **A** → chỉ A. **B** → chỉ B. Không lẫn nhau. Cả hai xếp số tua tăng dần.
- **C** → chỉ C, thứ tự như trước khi sửa.
- **D** → chỉ D, giờ làm giảm dần.
- KTV `work_type='TYPE_C'` mà mã **không** có tiền tố `EXT`/`C_` → phải nằm ở nhóm C, **không** lọt vào "Tất cả".
- Thứ tự nội bộ của A, B, C **giống hệt** trước khi sửa. Chụp màn hình trước/sau.
- Đổi bộ lọc → refresh → realtime đẩy về: thứ tự **không nhảy**. Chỗ dễ hỏng nhất, test kỹ.
- **Màn Quản lý nhân viên** (`reception/ktv-hub`): bộ lọc hiện đủ 5 tab, sửa tua thủ công vẫn chạy. Chụp màn hình.

---

### Bước 8 — Màn điều phối nhanh

`QuickDispatchTable.tsx:1201-1207` — đây là nơi **duy nhất** tự sắp xếp ở client, không đi qua `TurnQueueBoard`:

```ts
if (a.turns_completed !== b.turns_completed) return (a.turns_completed || 0) - (b.turns_completed || 0);
```

Sửa: dùng thứ tự API trả về, **client không sắp xếp lại**. Nhóm D hiển thị kèm giờ tích lũy để lễ tân hiểu vì sao thứ tự vậy.

**Nghiệm thu hồi quy**: thứ tự hiển thị của A/B/C **không đổi một ly**.

### Bước 8b — Sửa lỗi xoá hụt sổ tua khi nghỉ việc (§2.11)

`app/admin/employees/actions.ts:176`: `employeeId` → `employee_id`. Và đổi `console.warn` (dòng 178-180) thành lỗi thật, để lần sau không im lặng nữa.

**Nghiệm thu**: cho 1 KTV test nghỉ việc → kiểm tra `TurnQueue` **không còn** dòng của người đó. Trước khi sửa, đếm số dòng rác đang tồn và dán con số ra.

### Bước 9 — Dọn code chết

Sau khi `KtvTypeDTurnService` được gọi thật ở Bước 1: cập nhật `scripts/simulate_type_d_turn_order.ts` để test đúng hàm mới, gồm case **giờ âm** (§2.2) và case **`work_type_effective_from`** (§2.7).

---

## 5. Câu hỏi cần chốt trước khi code

1. **Hướng B** (chốt sổ đêm + bù trong ngày) — duyệt chứ?
2. ~~Hướng sắp xếp của D?~~ ✅ **Đã chốt 03/09: giảm dần.**
3. **§2.8** — giờ xếp hạng lấy **thời gian gán** (như tiền đang tính) hay **thời gian thực**? Nếu khác nhau thì sổ tua phải có hàm tính phút riêng, không dùng chung `calculateItemDuration`.
4. **Dịch vụ tiện ích** (`is_utility`) có tính vào giờ tích lũy không? `service-hours/route.ts:73-76` đang loại tiện ích ra, **trừ khi** KTV chỉ làm mỗi tiện ích thì lại tính — quy tắc lạ, cần xác nhận là cố ý.
5. **Giờ tích lũy có bị âm không?** Nếu KTV bị phạt nhiều hơn giờ làm: kẹp sàn về 0 (mất tác dụng răn đe, ai phạt nặng cũng bằng người mới), hay cho âm (tụt xuống dưới cả người mới)?
6. ~~Bộ lọc?~~ ✅ **Đã chốt 03/09**: tách lẻ — `Tất cả (A+B+D, không C)` · `A` · `B` · `C` · `D`.
7. **Còn treo**: bộ lọc cần có ở cả `app/reception/turns` **và** `TurnQueueBoard`, hay chỉ một trong hai?
8. **Còn treo**: trong "Tất cả", A và B là **hai khối riêng có tiêu đề riêng** (plan đang làm theo cách này), hay vẫn nằm chung một bảng liền mạch, chỉ tách khi bấm lọc?
9. **§2.12** — KTV Hub reset `turns_completed` về 0 khi đổi trạng thái sang `on_duty` (kể cả bản ghi đã có). Cố ý hay lỗi?

---

## 6. Thứ tự làm & mức rủi ro

| Bước | Ưu tiên | Rủi ro | Ghi chú |
|---|---|---|---|
| 1. Hàm dùng chung | P0 | Thấp | Làm trước, mọi bước sau phụ thuộc |
| 2. Ghi `hours_earned` | P0 | **Cao** — đụng cron tiền lương | Chỉ THÊM bản ghi, **không** đụng phần tính tiền |
| 3. Sửa `turns/route.ts` | P0 | Thấp | Chỉ Loại D |
| 4. Gộp 2 đường dữ liệu | P0 | Trung bình | Điều kiện cần cho mọi bước sau |
| 5. Tie-break | P1 | Thấp | |
| 6. `effective_from` | P1 | Thấp | |
| 7. Bộ lọc loại KTV | P1 | **Trung bình** — file dùng chung | Cần Bước 4 xong trước |
| 8. Điều phối nhanh | P1 | **Trung bình** | Bắt buộc hồi quy A/B/C |
| 8b. Sửa `employeeId` → `employee_id` | **P0** | Thấp | Lỗi thật, mọi loại KTV. Sửa được ngay, độc lập |
| 9. Dọn test | P2 | Thấp | |

> Bước **8b** không phụ thuộc bước nào — có thể làm ngay, trước cả Bước 1.

**Không được làm**: đụng luật xếp tua của A/B/C; đổi cách tính tiền trong `sync-daily-ledger-type-d`; xoá `KTVMonthlyServiceHours`.

**Trước khi báo xong**: `npx tsc --noEmit` sạch **và** `npm run build` chạy được — build đã từng fail ở các đợt trước, phải chạy thật, không suy đoán.
