# Plan: Đổi KTV sang loại C chưa có TurnQueue + queue_position phình 1000+

> **Mức 2** — chạm `lib/services/BookingItemPauseService.ts` (đổi KTV → hàng đợi, tua) và `app/reception/dispatch/page.tsx` (`handleDispatch`).
> Ngày lập: 14/09/2026 · sửa lại cùng ngày sau khi rà ảnh hưởng luồng đổi KTV (mục 3).
> Nhánh: `feat/bit-lo-hong-phase1`. Nối tiếp `plans/plan_ktv_loai_c_tai_khoan_that.md` mục 7.
> **Đã duyệt & đã làm 14/09/2026** — xem mục 8.

---

## 1. Nguyên nhân gốc

### Mục 2 — Đổi KTV sang loại C: quầy thấy sai trạng thái
- Commit `f01cc0a7` cho loại C "tua ảo" `waiting` ở client khi chưa có dòng `TurnQueue` → loại C lọt vào danh sách **Đổi KTV** (`page.tsx:3185` lấy `availableKtvs` từ `turns`).
- `swapKtvOnPausedItem` (`BookingItemPauseService.ts:500-504`) chỉ **`update`** dòng `TurnQueue` của người vào thay theo `(employee_id, date)`. Không có dòng → **0 dòng**, không báo lỗi.
- Hệ quả: tua (`TurnLedger` SWAP_KTV) và phiếu `KtvAssignments` ACTIVE vẫn ghi, đơn vẫn chạy tới DONE. **Nhưng** Sổ tua không thấy C đang làm, ô chọn KTV vẫn báo "✅ Sẵn sàng" → quầy có thể phân thêm đơn cho người đang làm; và mọi luồng sau đó tìm KTV qua `TurnQueue` đều **bỏ sót C** (mục 3).
- **Bằng chứng DB** (8 lần đổi KTV từ 08/09): người vào thay đều là D on-call (`T007`, `T069`) không có dòng TurnQueue, đơn vẫn DONE → thiếu dòng không làm hỏng đơn.

### Mục 4 — `queue_position` phình 1000+
- Tua ảo mang `queue_position: 999` (`useDispatchBoard.logic.ts:140`).
- `handleDispatch` (`page.tsx:1442`): `Math.max(...turns.map(t => t.queue_position), 0)` tính cả tua ảo → KTV phân mới nhận 1000+, RPC ghi xuống DB; điểm danh sau đó `max + 1` → dây chuyền phình.
- Không nơi nào sắp hàng theo cột này → **không đổi thứ tự tua**, chỉ số bị phình. Phụ: dòng thật `queue_position = null` → `NaN`.

---

## 2. Thay đổi đề xuất

### 2.1 `BookingItemPauseService.swapKtvOnPausedItem` — khối "Kéo KTV mới lên working" (dòng ~499)

Giữ nguyên lệnh `update` hiện có (A/B/D đã có dòng: **không đổi gì**). Thêm:

1. `update(...).select('id')` để biết có trúng dòng nào không.
2. Trúng **0 dòng** **và** người vào thay là **loại C** (`staffTypes` đã tải ở dòng 336) → `upsert` một dòng mang **đúng trạng thái mà A/B vào thay đang có sau lệnh update**:

   | Cột | Giá trị | Vì sao |
   |---|---|---|
   | `status` | **`'working'`** | Giống hệt A/B vào thay (lệnh update cũ đặt `working`). ⚠️ **Không dùng `assigned`**: `cancelBooking` xoá `TurnLedger` của mọi dòng `assigned` **kể cả khi quầy chọn "có công"** → C sẽ mất tua trong khi A/B cùng tình huống giữ tua (mục 3, dòng 2). |
   | `current_order_id` / `booking_item_id` | `item.bookingId` / `item.id` | như lệnh update cũ |
   | `booking_item_ids` | `[item.id]` | để quầy bấm Hoàn tất nhả được (`updateBookingItemStatus` lọc `overlaps('booking_item_ids')`) kể cả khi KTV chưa bấm Bắt đầu |
   | `queue_position` | `max(queue_position hôm đó) + 1` | không dùng 999 |
   | `turns_completed` | `0` | `syncTurnsForDate` tự đếm lại từ `TurnLedger` |

   `onConflict: 'employee_id,date'`, `ignoreDuplicates: true` → race 2 lệnh đổi cùng lúc không ghi đè dòng đã có.

**Không áp cho D / B on-call không có dòng** — tạo dòng cho D chưa online sẽ đưa họ vào Sổ tua D như có mặt cả ngày → lệch hàng giờ tích luỹ và luật kỷ luật D. Giữ hành vi cũ.

### 2.2 `app/reception/dispatch/page.tsx` — `handleDispatch` (dòng 1442)

```ts
// trước
const currentMax = Math.max(...turns.map(t => t.queue_position), 0);
// sau — bỏ tua ảo (id `fake-…`), chặn NaN khi cột null
const currentMax = Math.max(0, ...turns
    .filter(t => !String(t.id).startsWith('fake-'))
    .map(t => Number(t.queue_position) || 0));
```
Chỉ đổi 1 biểu thức trong `handleDispatch` (rule mục 8).

**Không đụng:** RPC / migration / công thức tiền / `_handlers/*` / `cancelBooking` / `BookingModificationService` / `turn-punish`.

---

## 3. Ảnh hưởng tới luồng đổi KTV (đã rà từng nhánh đọc `TurnQueue`)

Nguyên tắc kết quả: **sau sửa, C vào thay đi ĐÚNG như A/B vào thay ở mọi nhánh**. A/B/D: không đổi gì.

| # | Nhánh | C vào thay — HIỆN TẠI (không dòng) | C vào thay — SAU SỬA | A/B vào thay (tham chiếu) |
|---|---|---|---|---|
| 1 | **C lại bị đổi ra** (`swap` dòng 345-411) | Bỏ qua: không hạ `waiting`, **không gọi `promote_next_assignment`** → đơn QUEUED kế tiếp của C không được kéo lên | Hạ `waiting`, phiếu CANCELLED, kéo đơn kế tiếp, trả `queue_position` cũ | như sau sửa |
| 2 | **Huỷ cả đơn** khi C chưa làm (`cancelBooking` 1230-1255) | C không nằm trong `currentTurns` → **giữ tua SWAP_KTV kể cả huỷ không công** (trái bảng tra: HK = mất tua) | `working` → huỷ không công: `punishTurnIfIdle` tước tua; có công: giữ tua; nhả `waiting` | như sau sửa |
| 3 | **Huỷ 1 dịch vụ** (`cancelBookingItem`) | không nhả, không tước | nhả `waiting`; không công → `punishTurnIfIdle` | như sau sửa |
| 4 | **Xoá dịch vụ** (`removeBookingItem`) | không nhả | nhả `waiting` (hoặc bớt `booking_item_ids`) | như sau sửa |
| 5 | **Quầy bấm Hoàn tất** (`updateBookingItemStatus`) | không có gì để nhả | nhả `waiting` nhờ `booking_item_ids` | nhả được **chỉ sau khi KTV bấm Bắt đầu** (lệnh update cũ không set `booking_item_ids`) — C tốt hơn một chút, không có hại |
| 6 | **KTV mở app** (`handleGetBooking`) | phiếu ACTIVE → bỏ bước 2c; không đọc được thông tin hàng | phiếu ACTIVE → bỏ bước 2c; đọc được `room/bed/status` | như sau sửa |
| 7 | **KTV bấm Bắt đầu** (`handleStartTimer`) | `turnForSync = null` → không đồng bộ `start_time`, `estimated_end_time` | đồng bộ đủ; cổng "chưa tới giờ" không chặn vì `start_time = null` | như sau sửa |
| 8 | **KTV bàn giao xong** (`handleReleaseKTV` → `promote_next_assignment`) | không có dòng | RPC không xoá dòng `working` → nhả qua #5 | như sau sửa |
| 9 | **Tiếp tục sau đổi** (`resumeItem`) | không đọc TurnQueue | **không đổi** | không đọc |
| 10 | **Ô chọn KTV / Sổ tua / modal Đổi KTV** | C báo "Sẵn sàng" dù đang làm | C báo "Đang làm" | như sau sửa |

⚠️ **Thay đổi về tua cần bạn biết (dòng 2–3):** hiện tại C vào thay rồi đơn bị **huỷ không công** thì C **vẫn giữ tua** — là lỗi (A/B cùng tình huống bị tước). Sau sửa C bị tước giống A/B. Huỷ **có công** thì vẫn giữ tua như cũ.

---

## 4. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | App KTV C vào thay: `turnForSync` có → `START_TIMER` đồng bộ như A/B | Điều phối (ô chọn, Kanban), Sổ tua tab C, modal Đổi KTV | `TurnQueue`, `BookingItemPauseService` | Sửa |
| Tiền / tua / giờ | Hoàn tất bình thường: **không đổi**. Huỷ không công: C mất tua như A/B (trước: giữ nhầm) | Báo cáo đếm `TurnLedger` → khớp với phía KTV | `TurnLedger`, `turn-punish` | Khớp — sửa lệch có sẵn |
| Realtime / refresh | như cũ | Điều phối & Sổ tua đã subscribe `TurnQueue` | `TurnQueue` | Đồng bộ |
| Quyền xem | không đổi | không đổi | — | Không lộ |
| `queue_position` | Điểm danh `max+1` không nhảy 1000+ | KTV phân mới nhận vị trí thật | `TurnQueue.queue_position` | Chỉ số, không đổi thứ tự |

---

## 5. Bảng hệ quả — sự kiện Đổi KTV (CLAUDE.md mục 13)

Vai **VT** = người vào thay **loại C chưa có dòng TurnQueue**. Vai **ĐR** khi ĐR là A/B/D, và mọi vai khác: **không đổi — vì code của họ không bị chạm**. Khi **ĐR là C** (đã vào thay trước đó): xem mục 3 dòng 1.

| # | Khía cạnh | VT loại C — trước | VT loại C — sau |
|---|---|---|---|
| 1 | Tiền tua | số phút quầy chốt | **không đổi** |
| 2 | Giờ tích luỹ (D) | không áp dụng — vì C không tính giờ tích luỹ | không áp dụng |
| 3 | Lượt tua | +1 SWAP_KTV; **giữ cả khi huỷ không công** | +1 SWAP_KTV; huỷ không công → **tước như A/B** |
| 4 | Thưởng Xuất sắc | trọn suất | **không đổi** |
| 5 | Đánh giá khách | tính cho VT | **không đổi** |
| 6 | Dọn phòng / bàn giao | có | **không đổi** — đọc từ chặng |
| 7 | Nợ phòng / chặn tan ca | tính | **không đổi** — đọc từ chặng |
| 8 | Hạn mức bỏ qua bàn giao | tính | **không đổi** |
| 9 | **Hàng đợi** | phiếu ACTIVE, không dòng TurnQueue | phiếu ACTIVE + dòng `working` → nhả `waiting` như A/B |
| 10 | Màn app KTV | nhận đơn, không đọc được thông tin hàng | nhận đơn, đọc được |
| 11 | Đồng hồ | từ lúc bấm Bắt đầu | **không đổi** |
| 12 | Tự chốt khi hết giờ | không khi chưa bấm | **không đổi** — đọc từ chặng |
| 13 | Thẻ Kanban | dòng bình thường | **không đổi** |
| 14 | "Cùng làm với" | không hiện người bị đổi | **không đổi** |
| 15 | Lịch sử KTV | bình thường | **không đổi** |
| 16 | Nhật ký quầy | SWAP_SEND | **không đổi** |
| 17 | Lý do | — | **không đổi** |

---

## 6. Kiểm thử (bắt buộc — rule mục 9.8, 10, 13.6)

Mô phỏng Node, fixture đúng định dạng DB, đi đủ các bước route thật gọi, chạy thêm dưới `TZ=UTC`:

| Ca | Kiểm |
|---|---|
| 1KTV-1DV | A đang làm → đổi sang C chưa dòng → C có dòng `working`, A về `waiting` |
| 1KTV-2DV (gộp) | C vào thay dịch vụ gộp → `booking_item_ids = [item.id]`, không tách chặng |
| 2KTV-1DV | A + B cùng dịch vụ, đổi B sang C → A **không bị đụng** (rule 9.4) |
| Ca đêm qua 0h | `businessDate` hôm trước → dòng ghi đúng `date` ngày làm việc |
| Đổi C → rồi `resumeItem` | trạng thái hàng không đổi sau Tiếp tục |
| C vào thay rồi **bị đổi ra** | hạ `waiting` + gọi `promote_next_assignment` |
| C vào thay, **huỷ không công** / **có công** | tước tua / giữ tua — khớp A/B cùng fixture |
| Quầy Hoàn tất khi C chưa bấm Bắt đầu | dòng về `waiting` |
| C **đã có dòng** | đi nhánh `update` cũ, không insert |
| D on-call không dòng | **không insert** |
| Race 2 lệnh đổi cùng C | 1 dòng |
| `queuePos` | tua ảo 999 + dòng `null` → max dòng thật, không `NaN` |

Sau đó `npx tsc --noEmit`, cập nhật mục 2–3 `plans/nghiep_vu_tam_dung_doi_huy.md` (cột VT dòng 3, 9).

---

## 7. Về việc commit lên `main`

**Khuyến nghị: KHÔNG commit / cherry-pick thẳng lên `main`.** Đã thử khô:
- Nhánh và `main` tách từ **02/09**; nhánh trước 319 commit, `main` có **18 commit riêng** (mail SMTP, fix "tài khoản bị khoá vẫn đăng nhập được", cron kỷ luật D…).
- Cherry-pick 3 commit loại C lên `main`: **cả 3 conflict** (8 file).
- Merge cả nhánh vào `main`: **10 file conflict** (`app/login/*`, `lib/auth-context.tsx`, `vercel.json`, `cron/daily-absence-check`, `KtvDLedgerEngine`…).
- Đổi Vercel Production Branch sang nhánh: **mất 18 commit của main**.

**Đường đúng (task riêng, plan riêng):** merge `origin/main` vào nhánh → giải conflict trên nhánh → test → PR nhánh → `main`.

---

## 8. Kết quả thực hiện (14/09/2026)

**User chốt:** C vào thay mà huỷ không công → mất tua giống A/B · công tắc bật/tắt loại C vẫn ở Sổ tua như hiện tại (điều phối không bắt buộc bật).

| Mục | Code | Kiểm |
|---|---|---|
| 2 | `lib/services/BookingItemPauseService.ts`: tách `pullIncomingKtvToWorking` (export). Update như cũ; khớp 0 dòng **và** loại C → upsert dòng `working` + `booking_item_ids` + `queue_position = max+1`, `ignoreDuplicates`. D / B on-call không dòng: giữ hành vi cũ. | `scripts/qa/qa_swap_ktv_e2e.ts` mở rộng: **121/121**, giờ máy và `TZ=UTC` (50 phép cũ vẫn đạt) |
| 4 | `app/reception/dispatch/page.tsx` `handleDispatch`: `currentMax` bỏ id `fake-…`, `Number(...) \|\| 0` | mô phỏng 5/5 (có tua ảo, dòng null, chỉ tua ảo, rỗng, không tua ảo) |

`npx tsc --noEmit` sạch. Bảng tra `plans/nghiep_vu_tam_dung_doi_huy.md` mục 3 đã cập nhật.

**Còn lại (không làm trong task này):**
- A/B vào thay chưa bấm Bắt đầu: lệnh update không set `booking_item_ids` → huỷ 1 dịch vụ không công vẫn giữ tua, quầy Hoàn tất không nhả dòng. Lỗi có sẵn.
- D / B on-call vào thay không dòng: vẫn "Sẵn sàng" trên ô chọn. Cần chốt nghiệp vụ D.
- `pullIncomingKtvToWorking` trả `'inserted'` cho cả hai lệnh race dù chỉ 1 dòng được ghi (upsert `ignoreDuplicates` không báo) — chỉ là giá trị trả về, không ai đọc.
- Bản ở quầy vẫn chạy code cũ tới khi deploy; `main` cần task merge riêng (mục 7).
